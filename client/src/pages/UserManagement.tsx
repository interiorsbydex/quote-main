import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Users, Edit, Trash2, Search, ShieldCheck, Shield, User, UserPlus, Clock, CheckCircle } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "wouter";
import UserMenu from "@/components/UserMenu";
import { formatDistanceToNow } from "date-fns";

interface UserData {
  id: string;
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string;
  cohort: "PD" | "DTL" | null;
  managerId: string | null;
  status: string; // 'pending' or 'active'
  createdAt: string;
  updatedAt: string;
}

export default function UserManagement() {
  const { toast } = useToast();
  const { user: currentUser, isLoading: authLoading } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserData | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [userToEdit, setUserToEdit] = useState<UserData | null>(null);
  const [editRole, setEditRole] = useState("");
  const [editManagerId, setEditManagerId] = useState("none");
  const [editCohort, setEditCohort] = useState("none");
  
  // Add user dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newUserRole, setNewUserRole] = useState("user");
  const [newUserManagerId, setNewUserManagerId] = useState("none");
  const [newUserCohort, setNewUserCohort] = useState("none");

  const { data: users = [], isLoading } = useQuery<UserData[]>({
    queryKey: ['/api/admin/users'],
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ userId, data }: { userId: string; data: Partial<UserData> }) => {
      const res = await apiRequest('PATCH', `/api/admin/users/${userId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      toast({
        title: "Success",
        description: "User updated successfully",
      });
      setEditDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update user",
        variant: "destructive",
      });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest('DELETE', `/api/admin/users/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      toast({
        title: "Success",
        description: "User deleted successfully",
      });
      setDeleteDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete user",
        variant: "destructive",
      });
    },
  });

  const createUserMutation = useMutation({
    mutationFn: async (data: { username: string; password: string; firstName: string; lastName: string; role: string; managerId: string | null; cohort: string | null }) => {
      const res = await apiRequest('POST', '/api/admin/users', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      toast({
        title: "Success",
        description: "User created successfully. They can now log in with their username and password.",
      });
      setAddDialogOpen(false);
      setNewUsername("");
      setNewPassword("");
      setNewFirstName("");
      setNewLastName("");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create user",
        variant: "destructive",
      });
    },
  });

  const handleEditUser = (user: UserData) => {
    setUserToEdit(user);
    setEditRole(user.role);
    setEditManagerId(user.managerId || "none");
    setEditCohort(user.cohort || "none");
    setEditDialogOpen(true);
  };

  const handleSaveEdit = () => {
    if (userToEdit) {
      if (editRole === "tl" && editCohort === "none") {
        toast({
          title: "Team Lead cohort required",
          description: "Choose PD or DTL for a Team Lead",
          variant: "destructive",
        });
        return;
      }
      updateUserMutation.mutate({
        userId: userToEdit.id,
        data: {
          role: editRole,
          managerId: editManagerId === "none" ? null : editManagerId,
          cohort: editRole === "tl" ? (editCohort === "none" ? null : editCohort as "PD" | "DTL") : null,
        },
      });
    }
  };
  
  const handleAddUser = () => {
    setNewUsername("");
    setNewPassword("");
    setNewFirstName("");
    setNewLastName("");
    setNewUserRole("user");
    setNewUserManagerId("none");
    setNewUserCohort("none");
    setAddDialogOpen(true);
  };
  
  const handleSaveNewUser = () => {
    if (!newUsername.trim()) {
      toast({
        title: "Error",
        description: "Please enter a username",
        variant: "destructive",
      });
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      toast({
        title: "Error",
        description: "Password must be at least 6 characters",
        variant: "destructive",
      });
      return;
    }
    if (newUserRole === "tl" && newUserCohort === "none") {
      toast({
        title: "Team Lead cohort required",
        description: "Choose PD or DTL for a Team Lead",
        variant: "destructive",
      });
      return;
    }
    createUserMutation.mutate({
      username: newUsername.trim(),
      password: newPassword,
      firstName: newFirstName.trim(),
      lastName: newLastName.trim(),
      role: newUserRole,
      managerId: newUserManagerId === "none" ? null : newUserManagerId,
      cohort: newUserRole === "tl" ? (newUserCohort === "none" ? null : newUserCohort) : null,
    });
  };

  const handleDeleteUser = (user: UserData) => {
    setUserToDelete(user);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (userToDelete) {
      deleteUserMutation.mutate(userToDelete.id);
      setUserToDelete(null);
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "super_admin":
        return <ShieldCheck className="h-4 w-4 text-primary" />;
      case "admin":
        return <Shield className="h-4 w-4 text-blue-500" />;
      case "tl":
      case "bl":
      case "dm":
        return <Users className="h-4 w-4 text-primary" />;
      default:
        return <User className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case "super_admin":
        return <Badge variant="default">Super Admin</Badge>;
      case "admin":
        return <Badge variant="secondary">Admin</Badge>;
      case "tl":
        return <Badge>Team Lead</Badge>;
      case "bl":
        return <Badge variant="secondary">Business Lead</Badge>;
      case "dm":
        return <Badge variant="outline">Design Manager</Badge>;
      default:
        return <Badge variant="outline">Designer</Badge>;
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const isAdminOrSuperAdmin = currentUser && (currentUser.role === "admin" || currentUser.role === "super_admin");
  
  if (!isAdminOrSuperAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6">
            <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
            <p className="text-sm text-muted-foreground">
              You must be an admin or super admin to access this page.
            </p>
            <Link href="/">
              <Button className="mt-6 w-full" data-testid="button-back-dashboard">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Dashboard
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const admins = users.filter(u => u.role === "admin" || u.role === "super_admin");

  const filteredUsers = users.filter(user => {
    const matchesSearch = searchQuery === "" ||
      (user.email?.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (user.firstName?.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (user.lastName?.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (user.username?.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesRole = roleFilter === "all" || user.role === roleFilter;
    
    return matchesSearch && matchesRole;
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-semibold">User Management</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleAddUser} data-testid="button-add-user">
              <UserPlus className="mr-2 h-4 w-4" />
              Add User
            </Button>
            <Link href="/admin">
              <Button variant="outline" size="sm" data-testid="button-back-admin">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Admin Dashboard
              </Button>
            </Link>
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 md:px-6 py-8">
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row gap-4 md:items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">Team Members</h2>
              <p className="text-muted-foreground">
                Manage user roles and team assignments
              </p>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search users..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 w-[200px]"
                  data-testid="input-search-users"
                />
              </div>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-[150px]" data-testid="select-role-filter">
                  <SelectValue placeholder="Filter by role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  <SelectItem value="super_admin">Super Admin</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="user">Designer</SelectItem>
                  <SelectItem value="tl">Team Lead</SelectItem>
                  <SelectItem value="bl">Business Lead</SelectItem>
                  <SelectItem value="dm">Design Manager</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Users ({filteredUsers.length})</CardTitle>
              <CardDescription>
                View and manage all registered users
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading users...</div>
              ) : filteredUsers.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {users.length === 0 ? "No users found" : "No users match your search criteria"}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[80px]">Actions</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Cohort</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Manager</TableHead>
                        <TableHead>Joined</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsers.map((user) => (
                        <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button 
                                variant="ghost" 
                                size="icon"
                                onClick={() => handleEditUser(user)}
                                disabled={user.id === currentUser?.id || (currentUser?.role === "admin" && user.role === "super_admin")}
                                data-testid={`button-edit-user-${user.id}`}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon"
                                onClick={() => handleDeleteUser(user)}
                                disabled={user.id === currentUser?.id || (currentUser?.role === "admin" && (user.role === "admin" || user.role === "super_admin"))}
                                className="text-destructive hover:text-destructive"
                                data-testid={`button-delete-user-${user.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {getRoleIcon(user.role)}
                              <div>
                                <div className="font-medium">
                                  {user.firstName && user.lastName 
                                    ? `${user.firstName} ${user.lastName}` 
                                    : user.username}
                                </div>
                                <div className="text-xs text-muted-foreground">@{user.username}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {user.email || "-"}
                          </TableCell>
                          <TableCell>{getRoleBadge(user.role)}</TableCell>
                          <TableCell>
                            {user.cohort ? <Badge variant="outline">{user.cohort}</Badge> : "-"}
                          </TableCell>
                          <TableCell>
                            {user.status === "pending" ? (
                              <Badge variant="secondary" className="gap-1">
                                <Clock className="h-3 w-3" />
                                Pending
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="gap-1 text-green-600 border-green-600">
                                <CheckCircle className="h-3 w-3" />
                                Active
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {user.managerId 
                              ? users.find(u => u.id === user.managerId)?.username || user.managerId.slice(0, 8)
                              : "-"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDistanceToNow(new Date(user.createdAt), { addSuffix: true })}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update user role and team assignment
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>User</Label>
              <div className="text-sm text-muted-foreground">
                {userToEdit?.firstName && userToEdit?.lastName 
                  ? `${userToEdit.firstName} ${userToEdit.lastName}` 
                  : userToEdit?.username}
                {userToEdit?.email && ` (${userToEdit.email})`}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger data-testid="select-edit-role">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {currentUser?.role === "super_admin" && (
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                  )}
                   <SelectItem value="admin">Admin</SelectItem>
                   <SelectItem value="user">Designer</SelectItem>
                   <SelectItem value="tl">Team Lead</SelectItem>
                   <SelectItem value="bl">Business Lead</SelectItem>
                   <SelectItem value="dm">Design Manager</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editRole === "tl" && (
              <div className="space-y-2">
                <Label htmlFor="edit-cohort">TL Cohort</Label>
                <Select value={editCohort} onValueChange={setEditCohort}>
                  <SelectTrigger data-testid="select-edit-user-cohort">
                    <SelectValue placeholder="Select cohort" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PD">PD</SelectItem>
                    <SelectItem value="DTL">DTL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {editRole === "user" && (
              <div className="space-y-2">
                <Label htmlFor="manager">Manager</Label>
                <Select value={editManagerId} onValueChange={setEditManagerId}>
                  <SelectTrigger data-testid="select-edit-manager">
                    <SelectValue placeholder="Select manager" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Manager</SelectItem>
                    {admins.map((admin) => (
                      <SelectItem key={admin.id} value={admin.id}>
                        {admin.firstName && admin.lastName 
                          ? `${admin.firstName} ${admin.lastName}` 
                          : admin.username}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                   Designers can only see their own projects. The manager can see all team projects.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)} data-testid="button-cancel-edit">
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={updateUserMutation.isPending} data-testid="button-save-edit">
              {updateUserMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-medium">
                {userToDelete?.firstName && userToDelete?.lastName 
                  ? `${userToDelete.firstName} ${userToDelete.lastName}` 
                  : userToDelete?.username}
              </span>
              ? This will also delete all their projects. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-user">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDelete} 
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-user"
            >
              Delete User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
            <DialogDescription>
              Create a user account with username and password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  type="text"
                  placeholder="John"
                  value={newFirstName}
                  onChange={(e) => setNewFirstName(e.target.value)}
                  data-testid="input-new-user-firstname"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  type="text"
                  placeholder="Doe"
                  value={newLastName}
                  onChange={(e) => setNewLastName(e.target.value)}
                  data-testid="input-new-user-lastname"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                placeholder="johndoe"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                data-testid="input-new-user-username"
              />
              <p className="text-xs text-muted-foreground">
                Letters, numbers, and underscores only
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                data-testid="input-new-user-password"
              />
              <p className="text-xs text-muted-foreground">
                Minimum 6 characters
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="newRole">Role</Label>
              <Select value={newUserRole} onValueChange={setNewUserRole}>
                <SelectTrigger data-testid="select-new-user-role">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {currentUser?.role === "super_admin" && (
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                  )}
                   <SelectItem value="admin">Admin</SelectItem>
                   <SelectItem value="user">Designer</SelectItem>
                   <SelectItem value="tl">Team Lead</SelectItem>
                   <SelectItem value="bl">Business Lead</SelectItem>
                   <SelectItem value="dm">Design Manager</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {newUserRole === "tl" && (
              <div className="space-y-2">
                <Label htmlFor="new-cohort">TL Cohort</Label>
                <Select value={newUserCohort} onValueChange={setNewUserCohort}>
                  <SelectTrigger data-testid="select-new-user-cohort">
                    <SelectValue placeholder="Select cohort" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PD">PD</SelectItem>
                    <SelectItem value="DTL">DTL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {newUserRole === "user" && (
              <div className="space-y-2">
                <Label htmlFor="newManager">Manager</Label>
                <Select value={newUserManagerId} onValueChange={setNewUserManagerId}>
                  <SelectTrigger data-testid="select-new-user-manager">
                    <SelectValue placeholder="Select manager" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Manager</SelectItem>
                    {admins.map((admin) => (
                      <SelectItem key={admin.id} value={admin.id}>
                        {admin.firstName && admin.lastName 
                          ? `${admin.firstName} ${admin.lastName}` 
                          : admin.username}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                   Designers can only see their own projects. The manager can see all team projects.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)} data-testid="button-cancel-add">
              Cancel
            </Button>
            <Button onClick={handleSaveNewUser} disabled={createUserMutation.isPending} data-testid="button-save-new-user">
              {createUserMutation.isPending ? "Creating..." : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
