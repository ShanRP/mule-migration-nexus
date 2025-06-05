
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRight, CheckCircle2, AlertTriangle } from 'lucide-react';

interface MigrationDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  application: any;
  onMigrate: (selectedUpdates: string[]) => void;
}

const MigrationDetailsDialog = ({ open, onOpenChange, application, onMigrate }: MigrationDetailsDialogProps) => {
  const [selectedUpdates, setSelectedUpdates] = useState<string[]>([]);

  if (!application) return null;

  const handleUpdateSelection = (updateType: string, checked: boolean) => {
    if (checked) {
      setSelectedUpdates(prev => [...prev, updateType]);
    } else {
      setSelectedUpdates(prev => prev.filter(type => type !== updateType));
    }
  };

  const handleMigrate = () => {
    onMigrate(selectedUpdates);
    onOpenChange(false);
  };

  const getUpdateItems = () => {
    const items = [];

    // Mule Runtime Update
    items.push({
      type: 'mule-runtime',
      title: 'Mule Runtime',
      current: application.muleRuntime || 'Unknown',
      latest: '4.9.0',
      needsUpdate: application.muleRuntime !== '4.9.0',
      description: 'Update to latest Mule runtime for CloudHub 2.0 compatibility'
    });

    // Java Version Update
    items.push({
      type: 'java-version',
      title: 'Java Version',
      current: application.javaVersion || 'Unknown',
      latest: '17',
      needsUpdate: application.javaVersion !== '17',
      description: 'Update Java version in mule-artifact.json for CloudHub 2.0'
    });

    // Dependencies Updates
    if (application.dependencies && application.dependencies.length > 0) {
      application.dependencies.forEach((dep: any) => {
        if (dep.version !== dep.latestVersion) {
          items.push({
            type: `dependency-${dep.artifactId}`,
            title: `${dep.artifactId}`,
            current: dep.version,
            latest: dep.latestVersion,
            needsUpdate: true,
            description: dep.isDeprecated ? `Deprecated: ${dep.replacement || 'Update required'}` : 'Update to latest version',
            isDeprecated: dep.isDeprecated
          });
        }
      });
    }

    // Connector Updates
    if (application.connectors && application.connectors.length > 0) {
      application.connectors.forEach((conn: any) => {
        if (conn.isDeprecated) {
          items.push({
            type: `connector-${conn.name}`,
            title: `${conn.name} Connector`,
            current: 'Deprecated',
            latest: conn.cloudHub2Alternative || 'CloudHub 2.0 Compatible',
            needsUpdate: true,
            description: `Replace with: ${conn.cloudHub2Alternative}`,
            isDeprecated: true
          });
        }
      });
    }

    return items;
  };

  const updateItems = getUpdateItems();
  const requiredUpdates = updateItems.filter(item => item.needsUpdate);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            Migration Details: {application.applicationName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Application Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                Application Overview
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-600">Repository</p>
                <p className="font-medium">{application.name}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Branch</p>
                <p className="font-medium">{application.branch}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Current Mule Runtime</p>
                <p className="font-medium">{application.muleRuntime}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Current Java Version</p>
                <p className="font-medium">{application.javaVersion}</p>
              </div>
            </CardContent>
          </Card>

          {/* Available Updates */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-600" />
                Available Updates ({requiredUpdates.length})
              </CardTitle>
              <p className="text-sm text-gray-600">
                Select the updates you want to apply during migration. All selected updates will be applied to create a CloudHub 2.0 compatible version.
              </p>
            </CardHeader>
            <CardContent>
              {requiredUpdates.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500" />
                  <p className="text-lg font-medium">No updates required!</p>
                  <p>This application is already CloudHub 2.0 compatible.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {requiredUpdates.map((item) => (
                    <div key={item.type} className="border rounded-lg p-4 hover:bg-gray-50">
                      <div className="flex items-start gap-3">
                        <Checkbox
                          id={item.type}
                          checked={selectedUpdates.includes(item.type)}
                          onCheckedChange={(checked) => handleUpdateSelection(item.type, checked as boolean)}
                          className="mt-1"
                        />
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-2">
                            <label
                              htmlFor={item.type}
                              className="text-sm font-medium cursor-pointer flex items-center gap-2"
                            >
                              {item.title}
                              {item.isDeprecated && (
                                <Badge variant="destructive" className="text-xs">
                                  Deprecated
                                </Badge>
                              )}
                            </label>
                          </div>
                          
                          <div className="flex items-center gap-4 mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-600">Current:</span>
                              <Badge variant="outline" className="text-xs">
                                {item.current}
                              </Badge>
                            </div>
                            <ArrowRight className="h-4 w-4 text-gray-400" />
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-600">Latest:</span>
                              <Badge variant="default" className="text-xs bg-green-100 text-green-800">
                                {item.latest}
                              </Badge>
                            </div>
                          </div>
                          
                          <p className="text-xs text-gray-600">{item.description}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Migration Actions */}
          <div className="flex justify-between items-center pt-4 border-t">
            <div className="text-sm text-gray-600">
              {selectedUpdates.length > 0 ? (
                <span>{selectedUpdates.length} update(s) selected</span>
              ) : (
                <span>No updates selected</span>
              )}
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleMigrate}
                disabled={selectedUpdates.length === 0}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Migrate Selected Updates
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MigrationDetailsDialog;
