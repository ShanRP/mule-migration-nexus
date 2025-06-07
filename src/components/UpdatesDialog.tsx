
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  applicationName: string;
  muleRuntime: string;
  javaVersion: string;
  dependencies: MuleDependency[];
  connectors: MuleConnector[];
}

interface UpdatesDialogProps {
  application: MuleApplication | null;
  isOpen: boolean;
  onClose: () => void;
}

const UpdatesDialog: React.FC<UpdatesDialogProps> = ({
  application,
  isOpen,
  onClose
}) => {
  if (!application) return null;

  const runtimeUpdates = [];
  const dependencyUpdates = application.dependencies.filter(dep => dep.version !== dep.latestVersion);
  const deprecatedDependencies = application.dependencies.filter(dep => dep.isDeprecated);
  const deprecatedConnectors = application.connectors.filter(conn => conn.isDeprecated);

  if (application.muleRuntime !== getLatestMuleVersion()) {
    runtimeUpdates.push({
      type: 'Mule Runtime',
      current: application.muleRuntime,
      latest: getLatestMuleVersion()
    });
  }

  if (application.javaVersion !== getLatestJavaVersion()) {
    runtimeUpdates.push({
      type: 'Java Version',
      current: application.javaVersion,
      latest: getLatestJavaVersion()
    });
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Available Updates - {application.applicationName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Runtime Updates */}
          {runtimeUpdates.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Runtime Updates</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {runtimeUpdates.map((update, index) => (
                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <div className="font-medium">{update.type}</div>
                      <div className="text-sm text-gray-600">
                        Current: {update.current} → Latest: <span className="font-bold text-green-600">{update.latest}</span>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-yellow-600">Update Available</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Dependency Updates */}
          {dependencyUpdates.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Dependency Updates ({dependencyUpdates.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 max-h-60 overflow-y-auto">
                {dependencyUpdates.map((dep, index) => (
                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{dep.artifactId}</div>
                      <div className="text-sm text-gray-600 truncate">{dep.groupId}</div>
                      <div className="text-sm">
                        Current: {dep.version} → Latest: <span className="font-bold text-green-600">{dep.latestVersion}</span>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-yellow-600 text-xs">Update Available</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Deprecated Dependencies */}
          {deprecatedDependencies.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg text-red-600">Deprecated Dependencies ({deprecatedDependencies.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 max-h-60 overflow-y-auto">
                {deprecatedDependencies.map((dep, index) => (
                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg bg-red-50">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{dep.artifactId}</div>
                      <div className="text-sm text-gray-600 truncate">{dep.groupId}</div>
                      {dep.replacement && (
                        <div className="text-sm text-blue-600">Recommended: <span className="font-bold">{dep.replacement}</span></div>
                      )}
                    </div>
                    <Badge variant="destructive" className="text-xs">Deprecated</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Deprecated Connectors */}
          {deprecatedConnectors.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg text-red-600">Deprecated Connectors ({deprecatedConnectors.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 max-h-60 overflow-y-auto">
                {deprecatedConnectors.map((conn, index) => (
                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg bg-red-50">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{conn.name}</div>
                      <div className="text-sm text-gray-600 truncate">{conn.namespace}</div>
                      {conn.cloudHub2Alternative && (
                        <div className="text-sm text-blue-600">
                          CloudHub 2.0: <span className="font-bold">{conn.cloudHub2Alternative}</span>
                        </div>
                      )}
                    </div>
                    <Badge variant="destructive" className="text-xs">Deprecated</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UpdatesDialog;
