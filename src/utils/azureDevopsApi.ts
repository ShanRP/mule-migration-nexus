
// Azure DevOps API utility functions using CORS proxy
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
  private proxyUrl: string;

  constructor(organization: string, token: string) {
    this.organization = organization;
    this.token = token;
    this.baseUrl = `https://dev.azure.com/${organization}`;
    // Use a reliable CORS proxy service
    this.proxyUrl = 'https://api.allorigins.win/raw?url=';
  }

  private getAuthHeaders() {
    return {
      'Authorization': `Basic ${btoa(':' + this.token)}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  private async makeProxiedRequest(url: string): Promise<Response> {
    console.log(`Making proxied request to: ${url}`);
    
    // Encode the full URL with headers for the proxy
    const encodedUrl = encodeURIComponent(url);
    const proxyRequestUrl = `${this.proxyUrl}${encodedUrl}`;
    
    try {
      // First try with the proxy
      const response = await fetch(proxyRequestUrl, {
        method: 'GET',
        headers: {
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      
      if (response.ok) {
        console.log('Proxy request successful');
        return response;
      }
      
      console.log('Proxy request failed, trying alternative proxy...');
      
      // Try alternative proxy
      const altProxyUrl = 'https://cors-anywhere.herokuapp.com/';
      const altResponse = await fetch(altProxyUrl + url, {
        method: 'GET',
        headers: this.getAuthHeaders()
      });
      
      return altResponse;
    } catch (error) {
      console.log('Proxy request failed:', error);
      throw error;
    }
  }

  async getProjects(): Promise<AzureProject[]> {
    try {
      console.log('Fetching Azure DevOps projects using CORS proxy...');
      
      // Create a custom request that includes authentication
      const url = `${this.baseUrl}/_apis/projects?api-version=7.0`;
      
      try {
        // Use a different approach - create a request with authentication in the URL
        const authToken = btoa(':' + this.token);
        const authenticatedUrl = `https://dev.azure.com/${this.organization}/_apis/projects?api-version=7.0`;
        
        // Try using a service that can handle authenticated requests
        const corsProxyUrl = 'https://api.codetabs.com/v1/proxy?quest=';
        const proxyUrl = corsProxyUrl + encodeURIComponent(authenticatedUrl);
        
        const response = await fetch(proxyUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${authToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log(`Successfully fetched ${data.value?.length || 0} projects via proxy`);
          return data.value || [];
        } else {
          console.log(`Proxy request failed with status: ${response.status}`);
        }
      } catch (proxyError) {
        console.log('Proxy approach failed:', proxyError);
      }
      
      // Fallback: Return a default project based on the organization
      console.log('Using fallback approach for project discovery');
      return [{
        id: this.organization,
        name: this.organization,
        description: 'Default project (CORS fallback)'
      }];
    } catch (error) {
      console.error('Error fetching projects:', error);
      // Return organization as default project
      return [{
        id: this.organization,
        name: this.organization,
        description: 'Default project (error fallback)'
      }];
    }
  }

  async getRepositories(projectName: string): Promise<AzureRepository[]> {
    try {
      console.log(`Fetching repositories for project: ${projectName} using CORS proxy`);
      
      const url = `${this.baseUrl}/${projectName}/_apis/git/repositories?api-version=7.0`;
      
      try {
        // Use the same proxy approach for repositories
        const authToken = btoa(':' + this.token);
        const corsProxyUrl = 'https://api.codetabs.com/v1/proxy?quest=';
        const proxyUrl = corsProxyUrl + encodeURIComponent(url);
        
        const response = await fetch(proxyUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${authToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log(`Found ${data.value?.length || 0} repositories in project ${projectName} via proxy`);
          return data.value || [];
        } else {
          console.log(`Failed to fetch repositories via proxy: ${response.status}`);
        }
      } catch (proxyError) {
        console.log('Repository proxy request failed:', proxyError);
      }
      
      // If proxy fails, try a different approach - use Azure DevOps public API
      try {
        console.log('Trying Azure DevOps public API approach...');
        const publicUrl = `https://vsrm.dev.azure.com/${this.organization}/${projectName}/_apis/git/repositories?api-version=7.0`;
        const corsAnywhereUrl = 'https://cors-anywhere.herokuapp.com/';
        
        const response = await fetch(corsAnywhereUrl + publicUrl, {
          method: 'GET',
          headers: this.getAuthHeaders()
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log(`Found ${data.value?.length || 0} repositories via public API`);
          return data.value || [];
        }
      } catch (publicError) {
        console.log('Public API approach failed:', publicError);
      }
      
      console.log(`No repositories found for project ${projectName}`);
      return [];
    } catch (error) {
      console.error(`Error fetching repositories for project ${projectName}:`, error);
      return [];
    }
  }

  async getFileContent(projectName: string, repositoryId: string, filePath: string): Promise<string | null> {
    try {
      console.log(`Fetching file content: ${filePath} using CORS proxy`);
      
      const url = `${this.baseUrl}/${projectName}/_apis/git/repositories/${repositoryId}/items?path=${encodeURIComponent('/' + filePath)}&api-version=7.0`;
      
      try {
        const authToken = btoa(':' + this.token);
        const corsProxyUrl = 'https://api.codetabs.com/v1/proxy?quest=';
        const proxyUrl = corsProxyUrl + encodeURIComponent(url);
        
        const response = await fetch(proxyUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${authToken}`,
            'Accept': 'text/plain'
          }
        });
        
        if (response.ok) {
          const content = await response.text();
          console.log(`Successfully fetched ${filePath} via proxy (${content.length} characters)`);
          return content;
        } else {
          console.log(`Failed to fetch file ${filePath} via proxy: ${response.status}`);
        }
      } catch (proxyError) {
        console.log(`Error fetching file ${filePath} via proxy:`, proxyError);
      }
      
      return null;
    } catch (error) {
      console.log(`Error fetching file ${filePath}:`, error);
      return null;
    }
  }

  async listFiles(projectName: string, repositoryId: string, path: string = ''): Promise<string[]> {
    try {
      console.log(`Listing files in path: ${path || 'root'} using CORS proxy`);
      
      const url = `${this.baseUrl}/${projectName}/_apis/git/repositories/${repositoryId}/items?recursionLevel=Full&api-version=7.0${path ? `&scopePath=${encodeURIComponent(path)}` : ''}`;
      
      try {
        const authToken = btoa(':' + this.token);
        const corsProxyUrl = 'https://api.codetabs.com/v1/proxy?quest=';
        const proxyUrl = corsProxyUrl + encodeURIComponent(url);
        
        const response = await fetch(proxyUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${authToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          const files = (data.value || [])
            .filter((item: AzureFileItem) => !item.isFolder && item.path && !item.path.includes('/target/'))
            .map((item: AzureFileItem) => item.path.substring(1)); // Remove leading slash
          
          console.log(`Found ${files.length} files in ${path || 'repository'} via proxy`);
          return files;
        } else {
          console.log(`Failed to list files via proxy: ${response.status}`);
        }
      } catch (proxyError) {
        console.log('Error listing files via proxy:', proxyError);
      }
      
      return [];
    } catch (error) {
      console.error('Error listing files:', error);
      return [];
    }
  }

  async createBranch(projectName: string, repositoryId: string, branchName: string, sourceBranch: string): Promise<boolean> {
    try {
      console.log(`Creating branch ${branchName} from ${sourceBranch} using CORS proxy`);
      
      // Get the source branch commit first
      const branchUrl = `${this.baseUrl}/${projectName}/_apis/git/repositories/${repositoryId}/refs?filter=heads/${sourceBranch}&api-version=7.0`;
      
      try {
        const authToken = btoa(':' + this.token);
        const corsProxyUrl = 'https://api.codetabs.com/v1/proxy?quest=';
        const proxyUrl = corsProxyUrl + encodeURIComponent(branchUrl);
        
        const branchResponse = await fetch(proxyUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${authToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!branchResponse.ok) {
          console.log('Failed to get source branch info via proxy');
          return false;
        }
        
        const branchData = await branchResponse.json();
        const sourceCommitId = branchData.value[0]?.objectId;
        
        if (!sourceCommitId) {
          console.log('Could not find source commit ID');
          return false;
        }
        
        // Create new branch (this would need a POST proxy which is more complex)
        console.log('Branch creation via CORS proxy is not fully implemented');
        return false;
      } catch (error) {
        console.error('Error creating branch via proxy:', error);
        return false;
      }
    } catch (error) {
      console.error('Error creating branch:', error);
      return false;
    }
  }

  async commitFiles(projectName: string, repositoryId: string, branchName: string, files: Array<{path: string, content: string}>, message: string): Promise<boolean> {
    try {
      console.log(`Committing ${files.length} files to branch ${branchName} using CORS proxy`);
      
      // File commits via CORS proxy would require POST operations which are more complex
      console.log('File commits via CORS proxy is not fully implemented');
      return false;
    } catch (error) {
      console.error('Error committing files:', error);
      return false;
    }
  }
}

export const createAzureDevOpsAPI = (organization: string, token: string) => {
  return new AzureDevOpsAPI(organization, token);
};
