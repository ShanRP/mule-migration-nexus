
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/AuthProvider";
import { useOrganizations } from "@/providers/OrganizationProvider";
import { Building, ChevronDown, LogOut, Settings, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const Header = () => {
  const { user, logout } = useAuth();
  const { 
    organizations, 
    selectedOrganization, 
    selectOrganization, 
    createOrganization,
    loading: orgLoading 
  } = useOrganizations();
  
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateOrganization = async () => {
    if (!newOrgName.trim()) return;
    
    setIsCreating(true);
    try {
      await createOrganization(newOrgName.trim());
      setNewOrgName("");
      setIsCreateDialogOpen(false);
    } catch (error) {
      console.error('Failed to create organization:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div className="flex items-center space-x-3">
            <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <Building className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">MuleMigration</span>
          </div>

          {/* Organization Selector & User Menu */}
          <div className="flex items-center space-x-4">
            {/* Organization Selector */}
            {selectedOrganization && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button 
                    variant="outline" 
                    className="flex items-center space-x-2"
                    disabled={orgLoading}
                  >
                    <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center">
                      <span className="text-white text-xs font-bold">
                        {selectedOrganization.initial}
                      </span>
                    </div>
                    <span className="hidden sm:inline">{selectedOrganization.name}</span>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel>Organizations</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {organizations.map((org) => (
                    <DropdownMenuItem
                      key={org.id}
                      onClick={() => selectOrganization(org)}
                      className={`flex items-center space-x-2 ${
                        selectedOrganization.id === org.id ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center">
                        <span className="text-white text-xs font-bold">{org.initial}</span>
                      </div>
                      <div className="flex-1">
                        <div className="font-medium">{org.name}</div>
                        <div className="text-xs text-gray-500">
                          {org.invite_enabled ? 'Invite enabled' : 'Private'}
                        </div>
                      </div>
                      {selectedOrganization.id === org.id && (
                        <div className="w-2 h-2 rounded-full bg-blue-600" />
                      )}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                    <DialogTrigger asChild>
                      <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                        <Plus className="mr-2 h-4 w-4" />
                        Create Organization
                      </DropdownMenuItem>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                      <DialogHeader>
                        <DialogTitle>Create New Organization</DialogTitle>
                        <DialogDescription>
                          Add a new organization to manage your migration projects.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                          <Label htmlFor="name" className="text-right">
                            Name
                          </Label>
                          <Input
                            id="name"
                            value={newOrgName}
                            onChange={(e) => setNewOrgName(e.target.value)}
                            className="col-span-3"
                            placeholder="Enter organization name"
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button 
                          type="submit" 
                          onClick={handleCreateOrganization}
                          disabled={!newOrgName.trim() || isCreating}
                        >
                          {isCreating ? 'Creating...' : 'Create Organization'}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </DropdownMenuItem>
              </DropdownMenuContent>
            )}

            {/* User Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex items-center space-x-2">
                  <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center">
                    <span className="text-sm font-medium text-gray-700">
                      {user?.email?.[0]?.toUpperCase() || 'U'}
                    </span>
                  </div>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
