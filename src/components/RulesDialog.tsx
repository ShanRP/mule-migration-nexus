
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Settings, Plus, X, Save } from 'lucide-react';
import { toast } from 'sonner';
import { getLatestMuleVersion, getLatestJavaVersion } from '@/utils/muleDetection';

interface ConnectorReplacement {
  from: string;
  to: string;
}

interface DependencyVersion {
  artifactId: string;
  version: string;
}

interface MigrationRules {
  javaVersion: string;
  muleVersion: string;
  minMuleVersion: string;
  connectorReplacements: ConnectorReplacement[];
  dependencyVersions: DependencyVersion[];
}

interface RulesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveRules: (rules: MigrationRules) => void;
  currentRules?: MigrationRules;
}

const RulesDialog: React.FC<RulesDialogProps> = ({
  isOpen,
  onClose,
  onSaveRules,
  currentRules
}) => {
  const [rules, setRules] = useState<MigrationRules>({
    javaVersion: getLatestJavaVersion(),
    muleVersion: getLatestMuleVersion(),
    minMuleVersion: getLatestMuleVersion(),
    connectorReplacements: [
      { from: 'cloudhub', to: 'logger' }
    ],
    dependencyVersions: []
  });

  const [newConnectorFrom, setNewConnectorFrom] = useState('');
  const [newConnectorTo, setNewConnectorTo] = useState('');
  const [newDependencyArtifact, setNewDependencyArtifact] = useState('');
  const [newDependencyVersion, setNewDependencyVersion] = useState('');

  useEffect(() => {
    if (currentRules) {
      setRules(currentRules);
    }
  }, [currentRules]);

  const handleSaveRules = () => {
    onSaveRules(rules);
    toast.success('Migration rules saved successfully!');
    onClose();
  };

  const addConnectorReplacement = () => {
    if (newConnectorFrom.trim() && newConnectorTo.trim()) {
      setRules(prev => ({
        ...prev,
        connectorReplacements: [
          ...prev.connectorReplacements,
          { from: newConnectorFrom.trim(), to: newConnectorTo.trim() }
        ]
      }));
      setNewConnectorFrom('');
      setNewConnectorTo('');
    }
  };

  const removeConnectorReplacement = (index: number) => {
    setRules(prev => ({
      ...prev,
      connectorReplacements: prev.connectorReplacements.filter((_, i) => i !== index)
    }));
  };

  const addDependencyVersion = () => {
    if (newDependencyArtifact.trim() && newDependencyVersion.trim()) {
      setRules(prev => ({
        ...prev,
        dependencyVersions: [
          ...prev.dependencyVersions,
          { artifactId: newDependencyArtifact.trim(), version: newDependencyVersion.trim() }
        ]
      }));
      setNewDependencyArtifact('');
      setNewDependencyVersion('');
    }
  };

  const removeDependencyVersion = (index: number) => {
    setRules(prev => ({
      ...prev,
      dependencyVersions: prev.dependencyVersions.filter((_, i) => i !== index)
    }));
  };

  const resetToDefaults = () => {
    setRules({
      javaVersion: getLatestJavaVersion(),
      muleVersion: getLatestMuleVersion(),
      minMuleVersion: getLatestMuleVersion(),
      connectorReplacements: [
        { from: 'cloudhub', to: 'logger' }
      ],
      dependencyVersions: []
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Settings className="h-5 w-5" />
            <span>Migration Rules Configuration</span>
          </DialogTitle>
          <DialogDescription>
            Configure custom rules for migration. These rules will take priority over default settings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Runtime Versions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Runtime Versions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="javaVersion">Java Version</Label>
                  <Input
                    id="javaVersion"
                    value={rules.javaVersion}
                    onChange={(e) => setRules(prev => ({ ...prev, javaVersion: e.target.value }))}
                    placeholder="e.g., 17"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="muleVersion">Mule Runtime Version</Label>
                  <Input
                    id="muleVersion"
                    value={rules.muleVersion}
                    onChange={(e) => setRules(prev => ({ ...prev, muleVersion: e.target.value }))}
                    placeholder="e.g., 4.8.0"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="minMuleVersion">Min Mule Version</Label>
                  <Input
                    id="minMuleVersion"
                    value={rules.minMuleVersion}
                    onChange={(e) => setRules(prev => ({ ...prev, minMuleVersion: e.target.value }))}
                    placeholder="e.g., 4.8.0"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Connector Replacements */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Connector Replacements</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                {rules.connectorReplacements.map((replacement, index) => (
                  <div key={index} className="flex items-center space-x-2 p-2 border rounded">
                    <Badge variant="outline">{replacement.from}</Badge>
                    <span>→</span>
                    <Badge variant="secondary">{replacement.to}</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeConnectorReplacement(index)}
                      className="ml-auto"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              
              <div className="flex space-x-2">
                <Input
                  placeholder="From connector (e.g., cloudhub)"
                  value={newConnectorFrom}
                  onChange={(e) => setNewConnectorFrom(e.target.value)}
                />
                <Input
                  placeholder="To connector (e.g., logger)"
                  value={newConnectorTo}
                  onChange={(e) => setNewConnectorTo(e.target.value)}
                />
                <Button onClick={addConnectorReplacement} size="sm">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Dependency Versions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Custom Dependency Versions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                {rules.dependencyVersions.map((dependency, index) => (
                  <div key={index} className="flex items-center space-x-2 p-2 border rounded">
                    <Badge variant="outline">{dependency.artifactId}</Badge>
                    <span>→</span>
                    <Badge variant="secondary">{dependency.version}</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeDependencyVersion(index)}
                      className="ml-auto"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              
              <div className="flex space-x-2">
                <Input
                  placeholder="Artifact ID (e.g., mule-http-connector)"
                  value={newDependencyArtifact}
                  onChange={(e) => setNewDependencyArtifact(e.target.value)}
                />
                <Input
                  placeholder="Version (e.g., 1.10.3)"
                  value={newDependencyVersion}
                  onChange={(e) => setNewDependencyVersion(e.target.value)}
                />
                <Button onClick={addDependencyVersion} size="sm">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* JSON Preview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Rules JSON Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-gray-100 p-3 rounded text-sm overflow-auto max-h-40">
                {JSON.stringify(rules, null, 2)}
              </pre>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex justify-between items-center pt-4 border-t">
            <Button variant="outline" onClick={resetToDefaults}>
              Reset to Defaults
            </Button>
            <div className="flex space-x-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleSaveRules} className="flex items-center space-x-1">
                <Save className="h-4 w-4" />
                <span>Save Rules</span>
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RulesDialog;
