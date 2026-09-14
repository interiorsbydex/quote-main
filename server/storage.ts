import { db } from "./db";
import { eq, and, desc, or, inArray } from "drizzle-orm";
import { createProjectWithActiveVersion } from "./pricing-versions";
import {
  users,
  clients,
  projects,
  rooms,
  lineItems,
  companySettings,
  type User,
  type InsertUser,
  type UpsertUser,
  type Client,
  type InsertClient,
  type Project,
  type InsertProject,
  type Room,
  type InsertRoom,
  type LineItem,
  type InsertLineItem,
  type CompanySettings,
  type InsertCompanySettings,
} from "@shared/schema";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByOidcId(oidcId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getOrCreateMockUser(): Promise<User>;
  getTeamMembers(managerId: string): Promise<User[]>; // Get users whose managerId matches
  getAllUsers(): Promise<User[]>; // Admin only - get all users
  updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(id: string): Promise<void>;

  // Project operations
  getProject(id: string): Promise<Project | undefined>;
  getProjectByShareToken(shareToken: string): Promise<Project | undefined>;
  getProjectsByUser(userId: string): Promise<Project[]>;
  getProjectsByTeam(managerId: string): Promise<Project[]>; // Admin sees own + team's projects
  getAllProjects(): Promise<Project[]>; // Super admin only
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: string, data: Partial<InsertProject>): Promise<Project | undefined>;
  deleteProject(id: string): Promise<void>;
  duplicateProject(projectId: string, newUserId: string): Promise<Project>; // Duplicate with rooms and line items

  // Room operations
  getRoom(id: string): Promise<Room | undefined>;
  getRoomsByProject(projectId: string): Promise<Room[]>;
  createRoom(room: InsertRoom): Promise<Room>;
  updateRoom(id: string, data: Partial<InsertRoom>): Promise<Room | undefined>;
  deleteRoom(id: string): Promise<void>;
  duplicateRoom(roomId: string): Promise<Room>; // Duplicate room with all line items

  // Line item operations
  getLineItem(id: string): Promise<LineItem | undefined>;
  getLineItemsByRoom(roomId: string): Promise<LineItem[]>;
  getLineItemsByProject(projectId: string): Promise<LineItem[]>;
  createLineItem(lineItem: InsertLineItem): Promise<LineItem>;
  updateLineItem(id: string, data: Partial<InsertLineItem>): Promise<LineItem | undefined>;
  deleteLineItem(id: string): Promise<void>;

  // Client operations
  getClient(id: string): Promise<Client | undefined>;
  getClientsByUser(userId: string): Promise<Client[]>;
  createClient(client: InsertClient): Promise<Client>;
  updateClient(id: string, data: Partial<InsertClient>): Promise<Client | undefined>;
  deleteClient(id: string): Promise<void>;

  // Company settings operations
  getCompanySettings(): Promise<CompanySettings | undefined>;
  updateCompanySettings(data: Partial<InsertCompanySettings>): Promise<CompanySettings>;
}

export class DbStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.email, username)).limit(1);
    return result[0];
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    return result[0];
  }

  async getUserByOidcId(oidcId: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.oidcId, oidcId)).limit(1);
    return result[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const result = await db.insert(users).values(insertUser).returning();
    return result[0];
  }

  // Create or get mock user for development (fallback for non-auth mode)
  async getOrCreateMockUser(): Promise<User> {
    let user = await this.getUserByUsername("user@example.com");
    if (!user) {
      user = await this.createUser({
        id: "mock-user-id",
        username: "mockuser",
        password: "$2b$10$dummyhash", // Placeholder hash, not for actual login
        email: "user@example.com",
        firstName: "Mock",
        lastName: "User",
        role: "user",
      });
    }
    return user;
  }

  // Get team members (users whose managerId matches the given manager)
  async getTeamMembers(managerId: string): Promise<User[]> {
    return db.select().from(users).where(eq(users.managerId, managerId));
  }

  // Get all users (admin only)
  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt));
  }

  // Update user
  async updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined> {
    const result = await db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return result[0];
  }

  // Delete user
  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  // Project operations
  async getProject(id: string): Promise<Project | undefined> {
    const result = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return result[0];
  }

  async getProjectByShareToken(shareToken: string): Promise<Project | undefined> {
    const result = await db.select().from(projects).where(eq(projects.shareToken, shareToken)).limit(1);
    return result[0];
  }

  async getProjectsByUser(userId: string): Promise<Project[]> {
    return db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.updatedAt));
  }

  // Get projects for admin (team manager): their own + their team members' projects
  async getProjectsByTeam(managerId: string): Promise<Project[]> {
    // Get team member IDs
    const teamMembers = await this.getTeamMembers(managerId);
    const teamMemberIds = teamMembers.map(m => m.id);
    
    // Include manager's own ID
    const allUserIds = [managerId, ...teamMemberIds];
    
    return db.select()
      .from(projects)
      .where(inArray(projects.userId, allUserIds))
      .orderBy(desc(projects.updatedAt));
  }

  async getAllProjects(): Promise<Project[]> {
    return db.select().from(projects).orderBy(desc(projects.updatedAt));
  }

  async createProject(project: InsertProject): Promise<Project> {
    // Every quotation must be pinned to a pricing version, otherwise it silently reprices
    // the next time the catalog is published. A caller may supply one deliberately -- a
    // duplicate inherits the version of the quotation it was copied from -- and anything
    // else is stamped with whichever version is live at the moment of creation.
    if (!(project as any).pricingVersionId) {
      return await createProjectWithActiveVersion(project as any);
    }
    const result = await db.insert(projects).values(project).returning();
    return result[0];
  }

  async updateProject(id: string, data: Partial<InsertProject>): Promise<Project | undefined> {
    const result = await db
      .update(projects)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    return result[0];
  }

  async deleteProject(id: string): Promise<void> {
    await db.delete(projects).where(eq(projects.id, id));
  }

  // Duplicate a project with all its rooms and line items
  async duplicateProject(projectId: string, newUserId: string): Promise<Project> {
    const originalProject = await this.getProject(projectId);
    if (!originalProject) {
      throw new Error("Project not found");
    }

    // Create new project with "(Copy)" appended to client name
    const newProject = await this.createProject({
      userId: newUserId,
      clientName: `${originalProject.clientName} (Copy)`,
      projectType: originalProject.projectType,
      defaultCategory: originalProject.defaultCategory,
      multiStyleEnabled: originalProject.multiStyleEnabled,
      status: "Draft",
      markup: originalProject.markup || 0,
      // A copy must quote the same prices as the quotation it was copied from, so it
      // inherits the original's pricing version rather than jumping to the current one.
      pricingVersionId: originalProject.pricingVersionId,
    } as any);

    // Get all rooms from original project
    const originalRooms = await this.getRoomsByProject(projectId);
    
    // Map of old room ID to new room ID for line items
    const roomIdMap = new Map<string, string>();

    // Duplicate each room
    for (const room of originalRooms) {
      const newRoom = await this.createRoom({
        projectId: newProject.id,
        roomName: room.roomName,
        roomType: room.roomType,
        unitGroupName: room.unitGroupName,
        category: room.category,
      });
      roomIdMap.set(room.id, newRoom.id);

      // Get and duplicate line items for this room
      const originalLineItems = await this.getLineItemsByRoom(room.id);
      for (const lineItem of originalLineItems) {
        await this.createLineItem({
          roomId: newRoom.id,
          projectId: newProject.id,
          description: lineItem.description,
          unitType: lineItem.unitType,
          lengthFt: lineItem.lengthFt,
          heightFt: lineItem.heightFt,
          sqft: lineItem.sqft,
          lengthMm: lineItem.lengthMm,
          heightMm: lineItem.heightMm,
          rate: lineItem.rate,
          quantity: lineItem.quantity,
          amount: lineItem.amount,
          itemType: lineItem.itemType,
        });
      }
    }

    return newProject;
  }

  // Room operations
  async getRoom(id: string): Promise<Room | undefined> {
    const result = await db.select().from(rooms).where(eq(rooms.id, id)).limit(1);
    return result[0];
  }

  async getRoomsByProject(projectId: string): Promise<Room[]> {
    return db.select().from(rooms).where(eq(rooms.projectId, projectId));
  }

  async createRoom(room: InsertRoom): Promise<Room> {
    const result = await db.insert(rooms).values(room).returning();
    return result[0];
  }

  async updateRoom(id: string, data: Partial<InsertRoom>): Promise<Room | undefined> {
    const result = await db.update(rooms).set(data).where(eq(rooms.id, id)).returning();
    return result[0];
  }

  async deleteRoom(id: string): Promise<void> {
    await db.delete(rooms).where(eq(rooms.id, id));
  }

  async duplicateRoom(roomId: string): Promise<Room> {
    const originalRoom = await this.getRoom(roomId);
    if (!originalRoom) {
      throw new Error("Room not found");
    }

    // Create the new room with a copy suffix
    const newRoom = await this.createRoom({
      projectId: originalRoom.projectId,
      roomName: `${originalRoom.roomName} (Copy)`,
      roomType: originalRoom.roomType,
      unitGroupName: originalRoom.unitGroupName,
      category: originalRoom.category,
    });

    // Duplicate all line items
    const originalLineItems = await this.getLineItemsByRoom(roomId);
    for (const lineItem of originalLineItems) {
      await this.createLineItem({
        projectId: lineItem.projectId,
        roomId: newRoom.id,
        description: lineItem.description,
        unitType: lineItem.unitType,
        lengthFt: lineItem.lengthFt,
        heightFt: lineItem.heightFt,
        lengthMm: lineItem.lengthMm,
        heightMm: lineItem.heightMm,
        sqft: lineItem.sqft,
        quantity: lineItem.quantity,
        rate: lineItem.rate,
        amount: lineItem.amount,
        itemType: lineItem.itemType,
      });
    }

    return newRoom;
  }

  // Line item operations
  async getLineItem(id: string): Promise<LineItem | undefined> {
    const result = await db.select().from(lineItems).where(eq(lineItems.id, id)).limit(1);
    return result[0];
  }

  async getLineItemsByRoom(roomId: string): Promise<LineItem[]> {
    return db.select().from(lineItems).where(eq(lineItems.roomId, roomId));
  }

  async getLineItemsByProject(projectId: string): Promise<LineItem[]> {
    return db.select().from(lineItems).where(eq(lineItems.projectId, projectId));
  }

  async createLineItem(lineItem: InsertLineItem): Promise<LineItem> {
    const result = await db.insert(lineItems).values(lineItem).returning();
    return result[0];
  }

  async updateLineItem(id: string, data: Partial<InsertLineItem>): Promise<LineItem | undefined> {
    const result = await db.update(lineItems).set(data).where(eq(lineItems.id, id)).returning();
    return result[0];
  }

  async deleteLineItem(id: string): Promise<void> {
    await db.delete(lineItems).where(eq(lineItems.id, id));
  }

  // Company settings operations
  async getCompanySettings(): Promise<CompanySettings | undefined> {
    const result = await db.select().from(companySettings).limit(1);
    return result[0];
  }

  async updateCompanySettings(data: Partial<InsertCompanySettings>): Promise<CompanySettings> {
    const existing = await this.getCompanySettings();
    if (existing) {
      const result = await db
        .update(companySettings)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(companySettings.id, existing.id))
        .returning();
      return result[0];
    } else {
      const result = await db.insert(companySettings).values(data).returning();
      return result[0];
    }
  }

  // Client operations
  async getClient(id: string): Promise<Client | undefined> {
    const result = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
    return result[0];
  }

  async getClientsByUser(userId: string): Promise<Client[]> {
    return db.select().from(clients).where(eq(clients.userId, userId)).orderBy(desc(clients.updatedAt));
  }

  async createClient(client: InsertClient): Promise<Client> {
    const result = await db.insert(clients).values(client).returning();
    return result[0];
  }

  async updateClient(id: string, data: Partial<InsertClient>): Promise<Client | undefined> {
    const result = await db
      .update(clients)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(clients.id, id))
      .returning();
    return result[0];
  }

  async deleteClient(id: string): Promise<void> {
    await db.delete(clients).where(eq(clients.id, id));
  }
}

export const storage = new DbStorage();
