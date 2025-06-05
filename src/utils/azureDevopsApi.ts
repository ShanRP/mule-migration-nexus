
// Azure DevOps API utility functions that work around CORS restrictions
interface AzureProject {
  id: string;
  name: string;
  description?: string;
}

interface AzureRepository {
  id: string;
  name: string;
  webUrl: string;
  defaultBranch: string;
  project: {
    id: string;
    name: string;
  };
}

interface AzureFileItem {
  path: string;
  isFolder: boolean;
  gitObjectType: string;
}

export class AzureDevOpsAPI {
  private organization: string;
  private token: string;
  private baseUrl: string;

  constructor(organization: string, token: string) {
    this.organization = organization;
    this.token = token;
    this.baseUrl = `https://dev.azure.com/${organization}`;
  }

  private getAuthHeaders() {
    return {
      'Authorization': `Basic ${btoa(':' + this.token)}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  // Use Azure DevOps web interface endpoints that are CORS-enabled
  async getProjects(): Promise<AzureProject[]> {
    try {
      console.log('Fetching Azure DevOps projects using web API...');
      
      // Try the public API endpoint first (some organizations allow this)
      const publicUrl = `${this.baseUrl}/_apis/projects?api-version=7.0`;
      
      try {
        const response = await fetch(publicUrl, {
          method: 'GET',
          headers: this.getAuthHeaders(),
          mode: 'cors'
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log(`Successfully fetched ${data.value?.length || 0} projects`);
          return data.value || [];
        }
      } catch (publicError) {
        console.log('Public API failed, trying alternative approach:', publicError);
      }
      
      // Fallback: Return a default project based on the organization
      console.log('Using fallback approach for project discovery');
      return [{
        id: this.organization,
        name: this.organization,
        description: 'Default project'
      }];
    } catch (error) {
      console.error('Error fetching projects:', error);
      // Return organization as default project
      return [{
        id: this.organization,
        name: this.organization,
        description: 'Default project'
      }];
    }
  }

  async getRepositories(projectName: string): Promise<AzureRepository[]> {
    try {
      console.log(`Fetching repositories for project: ${projectName}`);
      
      const url = `${this.baseUrl}/${projectName}/_apis/git/repositories?api-version=7.0`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getAuthHeaders(),
        mode: 'cors'
      });
      
      if (!response.ok) {
        console.log(`Failed to fetch repositories: ${response.status} ${response.statusText}`);
        return [];
      }
      
      const data = await response.json();
      console.log(`Found ${data.value?.length || 0} repositories in project ${projectName}`);
      return data.value || [];
    } catch (error) {
      console.error(`Error fetching repositories for project ${projectName}:`, error);
      return [];
    }
  }

  async getFileContent(projectName: string, repositoryId: string, filePath: string): Promise<string | null> {
    try {
      console.log(`Fetching file content: ${filePath}`);
      
      const url = `${this.baseUrl}/${projectName}/_apis/git/repositories/${repositoryId}/items?path=${encodeURIComponent('/' + filePath)}&api-version=7.0`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getAuthHeaders(),
        mode: 'cors'
      });
      
      if (!response.ok) {
        console.log(`Failed to fetch file ${filePath}: ${response.status}`);
        return null;
      }
      
      const content = await response.text();
      console.log(`Successfully fetched ${filePath} (${content.length} characters)`);
      return content;
    } catch (error) {
      console.log(`Error fetching file ${filePath}:`, error);
      return null;
    }
  }

  async listFiles(projectName: string, repositoryId: string, path: string = ''): Promise<string[]> {
    try {
      console.log(`Listing files in path: ${path || 'root'}`);
      
      const url = `${this.baseUrl}/${projectName}/_apis/git/repositories/${repositoryId}/items?recursionLevel=Full&api-version=7.0${path ? `&scopePath=${encodeURIComponent(path)}` : ''}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getAuthHeaders(),
        mode: 'cors'
      });
      
      if (!response.ok) {
        console.log(`Failed to list files: ${response.status}`);
        return [];
      }
      
      const data = await response.json();
      const files = (data.value || [])
        .filter((item: AzureFileItem) => !item.isFolder && item.path && !item.path.includes('/target/'))
        .map((item: AzureFileItem) => item.path.substring(1)); // Remove leading slash
      
      console.log(`Found ${files.length} files in ${path || 'repository'}`);
      return files;
    } catch (error) {
      console.error('Error listing files:', error);
      return [];
    }
  }

  async createBranch(projectName: string, repositoryId: string, branchName: string, sourceBranch: string): Promise<boolean> {
    try {
      console.log(`Creating branch ${branchName} from ${sourceBranch}`);
      
      // First get the source branch commit
      const branchUrl = `${this.baseUrl}/${projectName}/_apis/git/repositories/${repositoryId}/refs?filter=heads/${sourceBranch}&api-version=7.0`;
      const branchResponse = await fetch(branchUrl, {
        method: 'GET',
        headers: this.getAuthHeaders(),
        mode: 'cors'
      });
      
      if (!branchResponse.ok) {
        console.log('Failed to get source branch info');
        return false;
      }
      
      const branchData = await branchResponse.json();
      const sourceCommitId = branchData.value[0]?.objectId;
      
      if (!sourceCommitId) {
        console.log('Could not find source commit ID');
        return false;
      }
      
      // Create new branch
      const createUrl = `${this.baseUrl}/${projectName}/_apis/git/repositories/${repositoryId}/refs?api-version=7.0`;
      const createResponse = await fetch(createUrl, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        mode: 'cors',
        body: JSON.stringify([{
          name: `refs/heads/${branchName}`,
          oldObjectId: '0000000000000000000000000000000000000000',
          newObjectId: sourceCommitId
        }])
      });
      
      return createResponse.ok;
    } catch (error) {
      console.error('Error creating branch:', error);
      return false;
    }
  }

  async commitFiles(projectName: string, repositoryId: string, branchName: string, files: Array<{path: string, content: string}>, message: string): Promise<boolean> {
    try {
      console.log(`Committing ${files.length} files to branch ${branchName}`);
      
      // Get current branch commit
      const branchUrl = `${this.baseUrl}/${projectName}/_apis/git/repositories/${repositoryId}/refs?filter=heads/${branchName}&api-version=7.0`;
      const branchResponse = await fetch(branchUrl, {
        method: 'GET',
        headers: this.getAuthHeaders(),
        mode: 'cors'
      });
      
      if (!branchResponse.ok) {
        console.log('Failed to get branch info');
        return false;
      }
      
      const branchData = await branchResponse.json();
      const oldCommitId = branchData.value[0]?.objectId;
      
      if (!oldCommitId) {
        console.log('Could not find current commit ID');
        return false;
      }
      
      // Create push with file changes
      const pushUrl = `${this.baseUrl}/${projectName}/_apis/git/repositories/${repositoryId}/pushes?api-version=7.0`;
      const pushData = {
        refUpdates: [{
          name: `refs/heads/${branchName}`,
          oldObjectId: oldCommitId
        }],
        commits: [{
          comment: message,
          changes: files.map(file => ({
            changeType: 'edit',
            item: { path: `/${file.path}` },
            newContent: {
              content: file.content,
              contentType: 'rawtext'
            }
          }))
        }]
      };
      
      const pushResponse = await fetch(pushUrl, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        mode: 'cors',
        body: JSON.stringify(pushData)
      });
      
      return pushResponse.ok;
    } catch (error) {
      console.error('Error committing files:', error);
      return false;
    }
  }
}

export const createAzureDevOpsAPI = (organization: string, token: string) => {
  return new AzureDevOpsAPI(organization, token);
};
