import { Express, Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { users } from "../shared/schema";
import { eq } from "drizzle-orm";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

declare module "express-session" {
  interface SessionData {
    userId: string;
    role: string;
    username: string;
    managerId: string | null; // Team manager reference for visibility
  }
}

export function setupAuth(app: Express) {
  app.post("/api/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }

      // Normalize username to lowercase for case-insensitive login
      const normalizedUsername = username.trim().toLowerCase();

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.username, normalizedUsername));

      if (!user) {
        return res.status(401).json({ message: "Invalid username or password" });
      }

      const isValidPassword = await bcrypt.compare(password, user.password);

      if (!isValidPassword) {
        return res.status(401).json({ message: "Invalid username or password" });
      }

      req.session.userId = user.id;
      req.session.role = user.role;
      req.session.username = user.username;
      req.session.managerId = user.managerId;

      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      res.json({
        id: user.id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        managerId: user.managerId,
      });
    } catch (error: any) {
      console.error("Login error:", error);
      res.status(500).json({ message: "An error occurred during login" });
    }
  });

  app.post("/api/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        console.error("Logout error:", err);
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.clearCookie("connect.sid");
      res.json({ message: "Logged out successfully" });
    });
  });

  app.get("/api/auth/user", async (req: Request, res: Response) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, req.session.userId));

      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      res.json({
        id: user.id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        managerId: user.managerId,
      });
    } catch (error: any) {
      console.error("Get user error:", error);
      res.status(500).json({ message: "An error occurred" });
    }
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}

// Super Admin only - highest level access
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId || req.session.role !== "super_admin") {
    return res.status(403).json({ message: "Forbidden - Super Admin access required" });
  }
  next();
}

// Admin or Super Admin - team manager level access
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const role = req.session.role || "";
  if (!req.session.userId || !["super_admin", "admin"].includes(role)) {
    return res.status(403).json({ message: "Forbidden - Admin access required" });
  }
  next();
}

// Helper to check if user can view another user's data based on hierarchy
export function canViewUserData(viewerRole: string, viewerId: string, viewerManagerId: string | null, targetUserId: string, targetManagerId: string | null): boolean {
  // Super admin can view all
  if (viewerRole === "super_admin") return true;
  
  // Admin (team manager) can view their own and their team members' data
  if (viewerRole === "admin") {
    // Can view own data
    if (viewerId === targetUserId) return true;
    // Can view team member data (users whose managerId matches viewerId)
    if (targetManagerId === viewerId) return true;
    return false;
  }
  
  // Regular user can only view their own data
  return viewerId === targetUserId;
}
