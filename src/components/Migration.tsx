
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Github, RefreshCw, GitBranch, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';
import { useOrganizations } from '@/providers/OrganizationProvider';

interface MuleDependency {
  groupId: string;
  artifactId: string;
  version: string;
  latestVersion: string;
  isDeprecated: boolean;
  replacement?: string;
}

interface MuleApplication {
  id: string;
  name: string;
  repository: string;
  branch: string;
  muleVersion: string;
  javaVersion: string;
  dependencies: MuleDependency[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  lastUpdated: string;
  selected?: boolean;
}

const Migration = () => {
  const { selectedOrganization } = useOrganizations();
  const [applications, setApplications] = useState<MuleApplication[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchingRepos, setFetchingRepos] = useState(false);
  const [migrating, setMigrating] = useState(false);

  const githubToken = selectedOrganization?.github_token || localStorage.getItem('MULE_githubToken') || '';

  const isMuleApplication = (pomXml: string): boolean => {
    // Check for Mule-specific indicators in pom.xml
    const muleIndicators = [
      /<groupId>org\.mule\./,
      /<artifactId>mule-/,
      /<mule\.version>/,
      /<packaging>mule-application<\/packaging>/,
      /<packaging>mule<\/packaging>/,
      /<plugin>[\s\S]*?<groupId>org\.mule\.tools\.maven<\/groupId>/,
      /<dependency>[\s\S]*?<groupId>org\.mule\.connectors<\/groupId>/,
      /<dependency>[\s\S]*?<groupId>org\.mule\.modules<\/groupId>/
    ];

    return muleIndicators.some(regex => regex.test(pomXml));
  };

  const extractMuleInfo = (pomXml: string) => {
    // Extract Mule version with multiple patterns
    const muleVersionPatterns = [
      /<mule\.version>(.*?)<\/mule\.version>/,
      /<version>(4\.\d+\.\d+)<\/version>[\s\S]*?<groupId>org\.mule/,
      /<version>(3\.\d+\.\d+)<\/version>[\s\S]*?<groupId>org\.mule/
    ];
    
    let muleVersion = 'Unknown';
    for (const pattern of muleVersionPatterns) {
      const match = pomXml.match(pattern);
      if (match && match[1]) {
        muleVersion = match[1];
        break;
      }
    }

    // Extract Java version
    const javaVersionPatterns = [
      /<java\.version>(.*?)<\/java\.version>/,
      /<maven\.compiler\.source>(.*?)<\/maven\.compiler\.source>/,
      /<maven\.compiler\.target>(.*?)<\/maven\.compiler\.target>/
    ];
    
    let javaVersion = 'Unknown';
    for (const pattern of javaVersionPatterns) {
      const match = pomXml.match(pattern);
      if (match && match[1]) {
        javaVersion = match[1];
        break;
      }
    }

    // Extract Mule-specific dependencies
    const depMatches = [...pomXml.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)];
    const dependencies = depMatches
      .map(match => {
        const depXml = match[1];
        const groupId = (depXml.match(/<groupId>(.*?)<\/groupId>/) || [])[1] || '';
        const artifactId = (depXml.match(/<artifactId>(.*?)<\/artifactId>/) || [])[1] || '';
        const version = (depXml.match(/<version>(.*?)<\/version>/) || [])[1] || '';
        
        return { groupId, artifactId, version };
      })
      .filter(dep => 
        dep.groupId.includes('mule') || 
        dep.artifactId.includes('mule') ||
        dep.groupId.includes('org.mule')
      )
      .map(dep => ({
        groupId: dep.groupId,
        artifactId: dep.artifactId,
        version: dep.version,
        latestVersion: dep.version,
        isDeprecated: false
      }));

    return { muleVersion, javaVersion, dependencies };
  };

  // Fetch all repos and scan for Mule apps
  const handleFetchRepositories = async () => {
    if (!githubToken) {
      toast.error('Please connect GitHub and provide a token in the Dashboard.');
      return;
    }
    setFetchingRepos(true);
    setError(null);
    setApplications([]);
    
    try {
      console.log('Starting repository scan from Migration...');
      
      // Fetch user/org repos with pagination
      const orgName = selectedOrganization?.github_url?.split('/').pop() || '';
      let allRepos = [];
      let page = 1;
      const perPage = 100;
      
      while (true) {
        const url = orgName
          ? `https://api.github.com/orgs/${orgName}/repos?per_page=${perPage}&page=${page}`
          : `https://api.github.com/user/repos?per_page=${perPage}&page=${page}`;
        
        console.log(`Fetching repositories page ${page}...`);
        const reposRes = await axios.get(url, {
          headers: { Authorization: `token ${githubToken}` }
        });
        
        if (reposRes.data.length === 0) break;
        allRepos.push(...reposRes.data);
        page++;
        
        // Limit to prevent excessive API calls (adjust as needed)
        if (page > 10) break;
      }
      
      console.log(`Found ${allRepos.length} total repositories`);
      
      // Check each repo for Mule applications
      const muleApps: MuleApplication[] = [];
      for (const repo of allRepos) {
        try {
          console.log(`Checking repository: ${repo.name}`);
          const pomRes = await axios.get(
            `https://api.github.com/repos/${repo.full_name}/contents/pom.xml`,
            { headers: { Authorization: `token ${githubToken}` } }
          );
          
          if (pomRes.data && pomRes.data.content) {
            // Decode base64 pom.xml
            const pomXml = atob(pomRes.data.content.replace(/\n/g, ''));
            
            // Check if it's actually a Mule application
            if (isMuleApplication(pomXml)) {
              console.log(`✓ Found Mule application: ${repo.name}`);
              
              const { muleVersion, javaVersion, dependencies } = extractMuleInfo(pomXml);
              
              muleApps.push({
                id: repo.id,
                name: repo.name,
                repository: repo.html_url,
                branch: repo.default_branch,
                muleVersion,
                javaVersion,
                dependencies,
                status: 'pending',
                lastUpdated: repo.updated_at
              });
            } else {
              console.log(`✗ Not a Mule application: ${repo.name}`);
            }
          }
        } catch (e) {
          // No pom.xml or access denied, skip silently
          console.log(`No pom.xml found in ${repo.name}`);
        }
      }
      
      console.log(`Found ${muleApps.length} Mule applications`);
      setApplications(muleApps);
      
      if (muleApps.length > 0) {
        toast.success(`Found ${muleApps.length} Mule application(s)!`);
      } else {
        toast.info('No Mule applications found in your repositories.');
      }
    } catch (err) {
      console.error('Repository scan error:', err);
      setError('Failed to fetch repositories');
      toast.error('Failed to fetch repositories. Please check your token and permissions.');
    } finally {
      setFetchingRepos(false);
    }
  };

  // Select/deselect apps
  const toggleApplicationSelection = (appId: string) => {
    setApplications(prev => prev.map(app => 
      app.id === appId ? { ...app, selected: !app.selected } : app
    ));
  };

  // Migrate selected apps: create branch, update pom.xml, commit
  const handleMigrateSelected = async () => {
    const selectedApps = applications.filter(app => app.selected);
    if (selectedApps.length === 0) {
      toast.error('Please select at least one application to migrate');
      return;
    }
    setMigrating(true);
    try {
      for (const app of selectedApps) {
        // 1. Get latest pom.xml SHA
        const pomRes = await axios.get(
          `https://api.github.com/repos/${app.repository.replace('https://github.com/', '')}/contents/pom.xml`,
          { headers: { Authorization: `token ${githubToken}` } }
        );
        const pomSha = pomRes.data.sha;
        const pomXml = atob(pomRes.data.content.replace(/\n/g, ''));
        // 2. Update dependencies to latest (for demo, just append a comment)
        const updatedPom = pomXml + '\n<!-- Updated for CloudHub 2.0 migration -->';
        // 3. Create a new branch from default
        const branchRes = await axios.get(
          `https://api.github.com/repos/${app.repository.replace('https://github.com/', '')}/git/refs/heads/${app.branch}`,
          { headers: { Authorization: `token ${githubToken}` } }
        );
        const baseSha = branchRes.data.object.sha;
        const newBranch = 'mulemigration';
        // Create branch (ignore if exists)
        try {
          await axios.post(
            `https://api.github.com/repos/${app.repository.replace('https://github.com/', '')}/git/refs`,
            {
              ref: `refs/heads/${newBranch}`,
              sha: baseSha
            },
            { headers: { Authorization: `token ${githubToken}` } }
          );
        } catch (e) {/* branch may already exist */}
        // 4. Commit updated pom.xml to new branch
        await axios.put(
          `https://api.github.com/repos/${app.repository.replace('https://github.com/', '')}/contents/pom.xml`,
          {
            message: 'Mule migration: update dependencies for CloudHub 2.0',
            content: btoa(updatedPom),
            branch: newBranch,
            sha: pomSha
          },
          { headers: { Authorization: `token ${githubToken}` } }
        );
      }
      toast.success('Migration branch created and pom.xml updated for selected apps!');
    } catch (err) {
      toast.error('Migration failed. Please check your token and repo permissions.');
    } finally {
      setMigrating(false);
    }
  };

  const getStatusColor = (status: MuleApplication['status']) => {
    switch (status) {
      case 'completed':
        return 'text-green-500';
      case 'in_progress':
        return 'text-yellow-500';
      case 'failed':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  };

  const getStatusIcon = (status: MuleApplication['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'in_progress':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <AlertTriangle className="h-5 w-5 text-gray-500" />;
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Mule Application Migration</h1>
          <p className="text-gray-600 mt-1">
            Scan your repositories and migrate Mule applications to CloudHub 2.0
          </p>
        </div>
        <Button onClick={handleFetchRepositories} disabled={fetchingRepos}>
          <RefreshCw className={`h-4 w-4 mr-2 ${fetchingRepos ? 'animate-spin' : ''}`} />
          {fetchingRepos ? 'Scanning...' : 'Fetch Mule Applications'}
        </Button>
      </div>
      {error && (
        <div className="text-red-600 mb-4">{error}</div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Mule Applications</CardTitle>
          <CardDescription>
            View and select Mule applications for migration
          </CardDescription>
        </CardHeader>
        <CardContent>
          {fetchingRepos ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            </div>
          ) : applications.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">No Mule applications found. Click 'Fetch Mule Applications' to scan.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">Select</TableHead>
                  <TableHead>Application</TableHead>
                  <TableHead>Repository</TableHead>
                  <TableHead>Mule Version</TableHead>
                  <TableHead>Java Version</TableHead>
                  <TableHead>Dependencies</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {applications.map((app) => (
                  <TableRow key={app.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={!!app.selected}
                        onChange={() => toggleApplicationSelection(app.id)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{app.name}</TableCell>
                    <TableCell>
                      <a href={app.repository} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                        {app.repository.split('/').slice(-2).join('/')}
                      </a>
                    </TableCell>
                    <TableCell>{app.muleVersion}</TableCell>
                    <TableCell>{app.javaVersion}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {app.dependencies.slice(0, 3).map((dep, index) => (
                          <div key={index} className="flex items-center space-x-2">
                            <span className="text-sm">{dep.artifactId}</span>
                            <Badge variant={dep.isDeprecated ? "destructive" : "secondary"} className="text-xs">
                              {dep.version}
                            </Badge>
                            {dep.isDeprecated && dep.replacement && (
                              <Badge variant="outline" className="text-yellow-600 text-xs">
                                Replace with {dep.replacement}
                              </Badge>
                            )}
                          </div>
                        ))}
                        {app.dependencies.length > 3 && (
                          <div className="text-xs text-gray-500">
                            +{app.dependencies.length - 3} more
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        {getStatusIcon(app.status)}
                        <span className={getStatusColor(app.status)}>
                          {app.status.replace('_', ' ')}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <div className="flex justify-end mt-4">
        <Button
          onClick={handleMigrateSelected}
          disabled={!applications.some(app => app.selected) || migrating}
        >
          {migrating ? 'Migrating...' : 'Migrate Selected'}
        </Button>
      </div>
    </div>
  );
};

export default Migration;
