import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";
import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}


export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const claims: any = tokens.claims() || {};
    const sub = claims["sub"];
    const email = claims["email"];
    const firstName = claims["first_name"];
    const lastName = claims["last_name"];
    const profileImageUrl = claims["profile_image_url"];
    
    const normalizedEmail = typeof email === "string" ? email.toLowerCase() : null;
    const oidcUserId = typeof sub === "string" ? sub : String(sub);
    
    let dbUser = null;
    
    // 1. First, try to find user by OIDC ID (for returning users who have logged in before)
    dbUser = await storage.getUserByOidcId(oidcUserId);
    if (dbUser) {
      // Update profile info for returning user (oidcId already set)
      dbUser = await storage.updateUser(dbUser.id, {
        email: normalizedEmail || dbUser.email,
        firstName: typeof firstName === "string" ? firstName : dbUser.firstName,
        lastName: typeof lastName === "string" ? lastName : dbUser.lastName,
        profileImageUrl: typeof profileImageUrl === "string" ? profileImageUrl : dbUser.profileImageUrl,
      });
    }
    
    // 1b. If not found by oidcId, check by primary key ID (for legacy users created before oidcId was added)
    if (!dbUser) {
      const legacyUser = await storage.getUser(oidcUserId);
      if (legacyUser) {
        // Link the OIDC ID to this legacy user
        dbUser = await storage.updateUser(legacyUser.id, {
          oidcId: oidcUserId,
          email: normalizedEmail || legacyUser.email,
          firstName: typeof firstName === "string" ? firstName : legacyUser.firstName,
          lastName: typeof lastName === "string" ? lastName : legacyUser.lastName,
          profileImageUrl: typeof profileImageUrl === "string" ? profileImageUrl : legacyUser.profileImageUrl,
        });
      }
    }
    
    // 2. If not found by OIDC ID, check by email (for pre-provisioned users on first login)
    if (!dbUser && normalizedEmail) {
      const existingUser = await storage.getUserByEmail(normalizedEmail);
      if (existingUser) {
        // Link this OIDC identity to the existing user and activate if pending
        dbUser = await storage.updateUser(existingUser.id, {
          oidcId: oidcUserId, // Link the OIDC identity
          firstName: typeof firstName === "string" ? firstName : existingUser.firstName,
          lastName: typeof lastName === "string" ? lastName : existingUser.lastName,
          profileImageUrl: typeof profileImageUrl === "string" ? profileImageUrl : existingUser.profileImageUrl,
          status: "active", // Activate if pending
        });
        if (existingUser.status === "pending") {
          console.log(`Activated pre-provisioned user: ${normalizedEmail}`);
        }
      }
    }
    
    // 3. If still no user found, create a new one
    if (!dbUser) {
      // Generate a username from email or user id
      const username = normalizedEmail 
        ? normalizedEmail.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "") 
        : `user${oidcUserId.slice(0, 8)}`;
      
      // Create new user with OIDC ID
      dbUser = await storage.createUser({
        oidcId: oidcUserId,
        username: username,
        password: "oauth-login", // Placeholder - user authenticates via OIDC, not password
        email: normalizedEmail,
        firstName: typeof firstName === "string" ? firstName : null,
        lastName: typeof lastName === "string" ? lastName : null,
        profileImageUrl: typeof profileImageUrl === "string" ? profileImageUrl : null,
        status: "active", // Users logging in directly via OIDC are active immediately
      });
    }
    
    if (!dbUser) {
      console.error("Failed to create or update user during OIDC authentication");
      return verified(new Error("Failed to authenticate user"), undefined);
    }
    
    const user: any = {
      id: dbUser.id,
      role: dbUser.role,
      email: dbUser.email,
    };
    updateUserSession(user, tokens);
    verified(null, user);
  };

  const registeredStrategies = new Set<string>();

  const ensureStrategy = (domain: string) => {
    const strategyName = `replitauth:${domain}`;
    if (!registeredStrategies.has(strategyName)) {
      const strategy = new Strategy(
        {
          name: strategyName,
          config,
          scope: "openid email profile offline_access",
          callbackURL: `https://${domain}/api/callback`,
        },
        verify,
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
  };

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      successReturnToOrRedirect: "/",
      failureRedirect: "/api/login",
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};
