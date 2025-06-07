
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ExternalLink, CheckCircle2, AlertTriangle, Save, Settings } from 'lucide-react';
import { getLatestMuleVersion, getLatestJavaVersion } from '@/utils/muleDetection';
import { toast } from 'sonner';

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

interface MigrationRules {
  javaVersion: string;
  muleVersion: string;
  minMuleVersion: string;
  connectorReplacements: { from: string; to: string; }[];
  dependencyVersions: { artifactId: string; version: string; }[];
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
  savedSelections?: MigrationSelections;
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
  onMigrate: (app: MuleApplication, selections: MigrationSelections, rules: MigrationRules) => Promise<void>;
  onSaveSelections: (app: MuleApplication, selections: MigrationSelections) => void;
  repositoryType: string;
  migrationRules: MigrationRules;
}

const MigrationDetailsDialog: React.FC<MigrationDetailsDialogProps> = ({
  application,
  isOpen,
  onClose,
  onMigrate,
  onSaveSelections,
  repositoryType,
  migrationRules
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
      if (application.savedSelections) {
        setSelections(application.savedSelections);
      } else {
        setSelections({
          muleRuntime: true,
          javaVersion: true,
          minMuleVersion: true,
          dependencies: application.dependencies.map(dep => dep.artifactId),
          connectors: application.connectors.map(conn => conn.name)
        });
      }
    }
  }, [application]);

  // Get rule-based versions (HIGHEST PRIORITY)
  const getRuleBasedJavaVersion = () => {
    return migrationRules.javaVersion || getLatestJavaVersion();
  };

  const getRuleBasedMuleVersion = () => {
    return migrationRules.muleVersion || getLatestMuleVersion();
  };

  const getRuleBasedMinMuleVersion = () => {
    return migrationRules.minMuleVersion || getLatestMuleVersion();
  };

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

  const handleSaveSelections = () => {
    if (application) {
      onSaveSelections(application, selections);
      toast.success('Migration selections saved successfully!');
    }
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
    
    console.log('=== MIGRATION WITH RULES PRIORITY ===');
    console.log('Migration Rules (HIGHEST PRIORITY):', migrationRules);
    console.log('Selections:', selections);
    
    setMigrating(true);
    try {
      // Pass migration rules to the migration function
      await onMigrate(application, selections, migrationRules);
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
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Migration Details: {application?.applicationName}</DialogTitle>
          <DialogDescription>
            Select components to migrate to CloudHub 2.0. <strong>Migration rules will take HIGHEST PRIORITY.</strong>
          </DialogDescription>
        </DialogHeader>

        {application && (
          <div className="space-y-6">
            {/* Rules Priority Warning */}
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-center space-x-2">
                <Settings className="h-5 w-5 text-yellow-600" />
                <div>
                  <p className="font-semibold text-yellow-800">Migration Rules Active (HIGHEST PRIORITY)</p>
                  <p className="text-sm text-yellow-700">
                    Java: <strong>{getRuleBasedJavaVersion()}</strong> | 
                    Mule: <strong>{getRuleBasedMuleVersion()}</strong> | 
                    MinMule: <strong>{getRuleBasedMinMuleVersion()}</strong>
                  </p>
                </div>
              </div>
            </div>

            {/* Runtime Updates */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <div className="flex-1">
                  <div className="font-medium">Mule Runtime</div>
                  <div className="text-sm text-gray-600">
                    Current: {application.muleRuntime} → Rules Priority: <span className="font-bold text-red-600">{getRuleBasedMuleVersion()}</span>
                  </div>
                </div>
                <Checkbox
                  checked={selections.muleRuntime}
                  onCheckedChange={(checked) => setSelections(prev => ({ ...prev, muleRuntime: !!checked }))}
                />
              </div>

              <div className="flex justify-between items-center">
                <div className="flex-1">
                  <div className="font-medium">Java Version (mule-artifact.json)</div>
                  <div className="text-sm text-gray-600">
                    Current: {application.javaVersion} → Rules Priority: <span className="font-bold text-red-600">{getRuleBasedJavaVersion()}</span>
                  </div>
                </div>
                <Checkbox
                  checked={selections.javaVersion}
                  onCheckedChange={(checked) => setSelections(prev => ({ ...prev, javaVersion: !!checked }))}
                />
              </div>

              <div className="flex justify-between items-center">
                <div className="flex-1">
                  <div className="font-medium">MinMuleVersion (mule-artifact.json)</div>
                  <div className="text-sm text-gray-600">
                    Rules Priority: <span className="font-bold text-red-600">{getRuleBasedMinMuleVersion()}</span>
                  </div>
                </div>
                <Checkbox
                  checked={selections.minMuleVersion}
                  onCheckedChange={(checked) => setSelections(prev => ({ ...prev, minMuleVersion: !!checked }))}
                />
              </div>
            </div>

            {/* Dependencies */}
            {application.dependencies.length > 0 && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div className="font-medium">Dependencies</div>
                  <div className="flex space-x-2">
                    <Button variant="outline" size="sm" onClick={handleSelectAll}>
                      Select All
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleDeselectAll}>
                      Deselect All
                    </Button>
                  </div>
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {application.dependencies.map(dep => {
                    // Check if there's a rule-based version for this dependency
                    const ruleBasedVersion = migrationRules.dependencyVersions.find(
                      rule => rule.artifactId === dep.artifactId
                    )?.version || dep.latestVersion;
                    
                    return (
                      <div key={dep.artifactId} className="flex items-center space-x-3 p-3 border rounded-lg">
                        <Checkbox
                          checked={selections.dependencies.includes(dep.artifactId)}
                          onCheckedChange={(checked) => handleDependencyToggle(dep.artifactId)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{dep.artifactId}</div>
                          <div className="text-sm text-gray-600">
                            {dep.groupId}
                          </div>
                          <div className="text-sm">
                            Current: {dep.version} → Rules Priority: <span className="font-bold text-red-600">{ruleBasedVersion}</span>
                          </div>
                        </div>
                        <div className="flex flex-col space-y-1">
                          {ruleBasedVersion !== dep.version && (
                            <Badge variant="destructive" className="text-xs">Rules Override</Badge>
                          )}
                          {dep.isDeprecated && (
                            <Badge variant="destructive" className="text-xs">Deprecated</Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Regular Connectors */}
            {application.connectors.filter(conn => !conn.isDeprecated).length > 0 && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div className="font-medium">Connectors</div>
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {application.connectors.filter(conn => !conn.isDeprecated).map(conn => {
                    // Check if there's a rule-based replacement for this connector
                    const ruleBasedReplacement = migrationRules.connectorReplacements.find(
                      rule => conn.name.toLowerCase().includes(rule.from.toLowerCase())
                    )?.to;
                    
                    return (
                      <div key={conn.name} className="flex items-center space-x-3 p-3 border rounded-lg">
                        <Checkbox
                          checked={selections.connectors.includes(conn.name)}
                          onCheckedChange={(checked) => handleConnectorToggle(conn.name)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{conn.name}</div>
                          <div className="text-sm text-gray-600 truncate">{conn.namespace}</div>
                        </div>
                        <div className="flex flex-col space-y-1">
                          {ruleBasedReplacement && (
                            <Badge variant="destructive" className="text-xs">
                              Rules: {ruleBasedReplacement}
                            </Badge>
                          )}
                          {conn.cloudHub2Alternative && (
                            <Badge variant="outline" className="text-blue-600 text-xs">
                              CloudHub 2.0: {conn.cloudHub2Alternative}
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Deprecated Connectors - Separate Section */}
            {application.connectors.filter(conn => conn.isDeprecated).length > 0 && (
              <div className="space-y-4">
                <div className="flex justify-between items-center pt-4 border-t">
                  <div className="flex items-center space-x-2">
                    <Badge variant="destructive">Deprecated Connectors (Action Required)</Badge>
                  </div>
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {application.connectors.filter(conn => conn.isDeprecated).map(conn => {
                    const ruleBasedReplacement = migrationRules.connectorReplacements.find(
                      rule => conn.name.toLowerCase().includes(rule.from.toLowerCase())
                    )?.to;
                    
                    return (
                      <div key={conn.name} className="flex items-center space-x-3 p-3 border rounded-lg bg-red-50">
                        <Checkbox
                          checked={selections.connectors.includes(conn.name)}
                          onCheckedChange={(checked) => handleConnectorToggle(conn.name)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{conn.name}</div>
                          <div className="text-sm text-gray-600 truncate">{conn.namespace}</div>
                        </div>
                        <div className="flex flex-col space-y-1">
                          <Badge variant="destructive" className="text-xs">Deprecated</Badge>
                          {ruleBasedReplacement && (
                            <Badge variant="destructive" className="text-xs">
                              Rules: {ruleBasedReplacement}
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Migration Actions */}
            <div className="flex justify-end space-x-2 pt-4 border-t">
              <Button variant="outline" onClick={handleSaveSelections}>
                Save Selections
              </Button>
              <Button 
                onClick={handleMigrate}
                disabled={migrating || !hasSelections}
                className="bg-red-600 hover:bg-red-700"
              >
                {migrating ? 'Migrating with Rules Priority...' : 'Start Migration (Rules Priority)'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default MigrationDetailsDialog;
