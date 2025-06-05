import axios from 'axios';

const AZURE_PROXY_BASE = 'http://localhost:3031/api/azure';

// Azure DevOps API utility functions using backend proxy
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

  constructor(organization: string, token: string) {
    this.organization = organization;
    this.token = token;
  }

  async getProjects(): Promise<AzureProject[]> {
    try {
      console.log('Fetching Azure DevOps projects via backend proxy...');
      const response = await axios.post(`${AZURE_PROXY_BASE}/projects`, {
        organization: this.organization,
        token: this.token
      });
      if (response.data && response.data.value) {
        console.log(`Successfully fetched ${response.data.value.length} projects`);
        return response.data.value;
      }
      console.log('No projects found in response');
      return [];
    } catch (error) {
      console.error('Error fetching projects:', error);
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401 || error.response?.status === 403) {
          throw new Error('Authentication failed. Please check your Azure DevOps PAT and permissions.');
        }
        if (error.response?.status === 404) {
          throw new Error('Organization not found. Please check your Azure DevOps organization URL.');
        }
      }
      throw new Error('Failed to fetch projects. Please try again later.');
    }
  }

  async getRepositories(projectName: string): Promise<AzureRepository[]> {
    try {
      console.log(`Fetching repositories for project: ${projectName} via backend proxy...`);
      const response = await axios.post(`${AZURE_PROXY_BASE}/repositories`, {
        organization: this.organization,
        project: projectName,
        token: this.token
      });
      if (response.data && response.data.value) {
        console.log(`Found ${response.data.value.length} repositories in project ${projectName}`);
        return response.data.value;
      }
      console.log(`No repositories found for project ${projectName}`);
      return [];
    } catch (error) {
      console.error(`Error fetching repositories for project ${projectName}:`, error);
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401 || error.response?.status === 403) {
          throw new Error('Authentication failed. Please check your Azure DevOps PAT and permissions.');
        }
        if (error.response?.status === 404) {
          throw new Error(`Project ${projectName} not found. Please check the project name.`);
        }
      }
      throw new Error(`Failed to fetch repositories for project ${projectName}. Please try again later.`);
    }
  }

  async listFiles(projectName: string, repositoryId: string): Promise<string[]> {
    try {
      const response = await axios.post(`${AZURE_PROXY_BASE}/listFiles`, {
        organization: this.organization,
        project: projectName,
        repositoryId,
        token: this.token
      });
      if (response.data && Array.isArray(response.data.files)) {
        return response.data.files;
      }
      return [];
    } catch (error) {
      console.error('Error listing files:', error);
      return [];
    }
  }

  async getFileContent(projectName: string, repositoryId: string, filePath: string): Promise<string | null> {
    try {
      const response = await axios.post(`${AZURE_PROXY_BASE}/fileContent`, {
        organization: this.organization,
        project: projectName,
        repositoryId,
        filePath,
        token: this.token
      });
      if (response.data && typeof response.data.content === 'string') {
        return response.data.content;
      }
      return null;
    } catch (error) {
      console.error('Error fetching file content:', error);
      return null;
    }
  }

  async createBranch(projectName: string, repositoryId: string, branchName: string, sourceBranch: string): Promise<boolean> {
    try {
      const response = await axios.post(`${AZURE_PROXY_BASE}/createBranch`, {
        organization: this.organization,
        project: projectName,
        repositoryId,
        branchName,
        sourceBranch,
        token: this.token
      });
      return response.data && response.data.success;
    } catch (error) {
      console.error('Error creating branch:', error);
      return false;
    }
  }

  async commitFiles(projectName: string, repositoryId: string, branchName: string, files: Array<{path: string, content: string}>, message: string): Promise<boolean> {
    try {
      const response = await axios.post(`${AZURE_PROXY_BASE}/commitFiles`, {
        organization: this.organization,
        project: projectName,
        repositoryId,
        branchName,
        files,
        message,
        token: this.token
      });
      return response.data && response.data.success;
    } catch (error) {
      console.error('Error committing files:', error);
      return false;
    }
  }
}

export const createAzureDevOpsAPI = (organization: string, token: string) => {
  return new AzureDevOpsAPI(organization, token);
};
