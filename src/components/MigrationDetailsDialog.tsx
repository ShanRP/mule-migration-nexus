
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ExternalLink, CheckCircle2, AlertTriangle } from 'lucide-react';
import { getLatestMuleVersion, getLatestJavaVersion } from '@/utils/muleDetection';

interface MuleDependency {
  groupId: string;
  artifactId: string;
  version: string;
  latestVersion: string;
  isDeprecated: boolean;
  replacement?: string;
}

interface MuleConnector {
  name: string;
  namespace: string;
  isDeprecated: boolean;
  cloudHub2Alternative?: string;
}

interface MuleApplication {
  id: string;
  name: string;
  repository: string;
  branch: string;
  muleVersion: string;
  javaVersion: string;
  dependencies: MuleDependency[];
  connectors: MuleConnector[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  lastUpdated: string;
  selected?: boolean;
  applicationName: string;
  muleRuntime: string;
  artifactJson?: Record<string, any>;
  pomPaths?: string[];
  artifactJsonPaths?: string[];
  projectXmlPaths?: string[];
}

interface MigrationSelections {
  muleRuntime: boolean;
  javaVersion: boolean;
  minMuleVersion: boolean;
  dependencies: string[];
  connectors: string[];
}

interface MigrationDetailsDialogProps {
  application: MuleApplication | null;
  isOpen: boolean;
  onClose: () => void;
  onMigrate: (app: MuleApplication, selections: MigrationSelections) => Promise<void>;
  repositoryType: string;
}

const MigrationDetailsDialog: React.FC<MigrationDetailsDialogProps> = ({
  application,
  isOpen,
  onClose,
  onMigrate,
  repositoryType
}) => {
  const [selections, setSelections] = useState<MigrationSelections>({
    muleRuntime: true,
    javaVersion: true,
    minMuleVersion: true,
    dependencies: [],
    connectors: []
  });
  const [migrating, setMigrating] = useState(false);

  // Initialize selections when application changes
  useEffect(() => {
    if (application) {
      setSelections({
        muleRuntime: true,
        javaVersion: true,
        minMuleVersion: true,
        dependencies: application.dependencies.map(dep => dep.artifactId),
        connectors: application.connectors.map(conn => conn.name)
      });
    }
  }, [application]);

  const handleSelectAll = () => {
    if (application) {
      setSelections({
        muleRuntime: true,
        javaVersion: true,
        minMuleVersion: true,
        dependencies: application.dependencies.map(dep => dep.artifactId),
        connectors: application.connectors.map(conn => conn.name)
      });
    }
  };

  const handleDeselectAll = () => {
    setSelections({
      muleRuntime: false,
      javaVersion: false,
      minMuleVersion: false,
      dependencies: [],
      connectors: []
    });
  };

  const handleDependencyToggle = (artifactId: string) => {
    setSelections(prev => ({
      ...prev,
      dependencies: prev.dependencies.includes(artifactId)
        ? prev.dependencies.filter(id => id !== artifactId)
        : [...prev.dependencies, artifactId]
    }));
  };

  const handleConnectorToggle = (connectorName: string) => {
    setSelections(prev => ({
      ...prev,
      connectors: prev.connectors.includes(connectorName)
        ? prev.connectors.filter(name => name !== connectorName)
        : [...prev.connectors, connectorName]
    }));
  };

  const handleMigrate = async () => {
    if (!application) return;
    
    setMigrating(true);
    try {
      await onMigrate(application, selections);
      onClose();
    } catch (error) {
      console.error('Migration failed:', error);
    } finally {
      setMigrating(false);
    }
  };

  if (!application) return null;

  const hasSelections = selections.muleRuntime || selections.javaVersion || selections.minMuleVersion || 
                      selections.dependencies.length > 0 || selections.connectors.length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <span>{application.applicationName}</span>
            <a 
              href={application.repository} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="text-blue-600 hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </DialogTitle>
          <DialogDescription>
            Select the components you want to migrate for CloudHub 2.0 compatibility
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Action Buttons */}
          <div className="flex space-x-2">
            <Button variant="outline" size="sm" onClick={handleSelectAll}>
              Select All
            </Button>
            <Button variant="outline" size="sm" onClick={handleDeselectAll}>
              Deselect All
            </Button>
          </div>

          {/* Runtime Configuration */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Runtime Configuration</h3>
            
            <div className="flex items-center space-x-3 p-3 border rounded-lg">
              <Checkbox
                checked={selections.muleRuntime}
                onCheckedChange={(checked) => setSelections(prev => ({ ...prev, muleRuntime: checked as boolean }))}
              />
              <div className="flex-1">
                <div className="font-medium">Mule Runtime</div>
                <div className="text-sm text-gray-600">
                  Current: {application.muleRuntime} → Latest: {getLatestMuleVersion()}
                </div>
              </div>
              {application.muleRuntime !== getLatestMuleVersion() && (
                <Badge variant="outline" className="text-yellow-600">Update Available</Badge>
              )}
            </div>

            <div className="flex items-center space-x-3 p-3 border rounded-lg">
              <Checkbox
                checked={selections.javaVersion}
                onCheckedChange={(checked) => setSelections(prev => ({ ...prev, javaVersion: checked as boolean }))}
              />
              <div className="flex-1">
                <div className="font-medium">Java Version (mule-artifact.json)</div>
                <div className="text-sm text-gray-600">
                  Current: {application.javaVersion} → Latest: {getLatestJavaVersion()}
                </div>
              </div>
              {application.javaVersion !== getLatestJavaVersion() && (
                <Badge variant="outline" className="text-yellow-600">Update Available</Badge>
              )}
            </div>

            <div className="flex items-center space-x-3 p-3 border rounded-lg">
              <Checkbox
                checked={selections.minMuleVersion}
                onCheckedChange={(checked) => setSelections(prev => ({ ...prev, minMuleVersion: checked as boolean }))}
              />
              <div className="flex-1">
                <div className="font-medium">MinMuleVersion (mule-artifact.json)</div>
                <div className="text-sm text-gray-600">
                  Sync with Mule Runtime: {getLatestMuleVersion()}
                </div>
              </div>
              <Badge variant="outline" className="text-blue-600">Sync Required</Badge>
            </div>
          </div>

          {/* Dependencies */}
          {application.dependencies.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Dependencies ({application.dependencies.length})</h3>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {application.dependencies.map(dep => (
                  <div key={dep.artifactId} className="flex items-center space-x-3 p-3 border rounded-lg">
                    <Checkbox
                      checked={selections.dependencies.includes(dep.artifactId)}
                      onCheckedChange={() => handleDependencyToggle(dep.artifactId)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{dep.artifactId}</div>
                      <div className="text-sm text-gray-600">
                        {dep.groupId}
                      </div>
                      <div className="text-sm">
                        Current: {dep.version} → Latest: {dep.latestVersion}
                      </div>
                    </div>
                    <div className="flex flex-col space-y-1">
                      {dep.version !== dep.latestVersion && (
                        <Badge variant="outline" className="text-yellow-600 text-xs">Update Available</Badge>
                      )}
                      {dep.isDeprecated && (
                        <Badge variant="destructive" className="text-xs">Deprecated</Badge>
                      )}
                      {dep.replacement && (
                        <Badge variant="secondary" className="text-xs">Replace: {dep.replacement}</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Connectors */}
          {application.connectors.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Connectors ({application.connectors.length})</h3>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {application.connectors.map(conn => (
                  <div key={conn.name} className="flex items-center space-x-3 p-3 border rounded-lg">
                    <Checkbox
                      checked={selections.connectors.includes(conn.name)}
                      onCheckedChange={() => handleConnectorToggle(conn.name)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{conn.name}</div>
                      <div className="text-sm text-gray-600 truncate">{conn.namespace}</div>
                    </div>
                    <div className="flex flex-col space-y-1">
                      {conn.isDeprecated && (
                        <Badge variant="destructive" className="text-xs">Deprecated</Badge>
                      )}
                      {conn.cloudHub2Alternative && (
                        <Badge variant="outline" className="text-blue-600 text-xs">
                          CloudHub 2.0: {conn.cloudHub2Alternative}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Migration Actions */}
          <div className="flex justify-between items-center pt-4 border-t">
            <div className="flex items-center space-x-2">
              {hasSelections ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
              )}
              <span className="text-sm text-gray-600">
                {hasSelections ? 'Ready to migrate selected items' : 'No items selected for migration'}
              </span>
            </div>
            <div className="flex space-x-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button 
                onClick={handleMigrate} 
                disabled={!hasSelections || migrating}
              >
                {migrating ? 'Migrating...' : 'Migrate Selected'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MigrationDetailsDialog;
