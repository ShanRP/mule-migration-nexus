import axios from 'axios';
import { supabase } from "@/integrations/supabase/client";

// Azure DevOps API utility functions using Supabase Edge Functions
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

interface MigrationRules {
  javaVersion: string;
  muleVersion: string;
  minMuleVersion: string;
  connectorReplacements: { from: string; to: string; }[];
  dependencyVersions: { artifactId: string; version: string; }[];
}

export class AzureDevOpsAPI {
  private organization: string;
  private token: string;

  constructor(organization: string, token: string) {
    this.organization = organization;
    this.token = token;
  }

  private async callEdgeFunction(endpoint: string, data: any) {
    try {
      const requestBody = { 
        endpoint,
        ...data, 
        organization: this.organization, 
        token: this.token 
      };
      
      console.log('=== CALLING AZURE DEVOPS EDGE FUNCTION ===');
      console.log('Endpoint:', endpoint);
      console.log('Data being sent:', requestBody);
      
      const { data: response, error } = await supabase.functions.invoke('azure-devops', {
        body: requestBody
      });

      if (error) {
        console.error('Edge function error:', error);
        throw new Error(error.message || 'Failed to call Azure DevOps API');
      }

      return response;
    } catch (error) {
      console.error(`Error calling edge function ${endpoint}:`, error);
      throw error;
    }
  }

  async getProjects(): Promise<AzureProject[]> {
    try {
      // console.log('Fetching Azure DevOps projects via Supabase Edge Function...');
      const response = await this.callEdgeFunction('projects', {});
      
      if (response && response.value) {
        // console.log(`Successfully fetched ${response.value.length} projects`);
        return response.value;
      }
      // console.log('No projects found in response');
      return [];
    } catch (error) {
      console.error('Error fetching projects:', error);
      if (error.message?.includes('401') || error.message?.includes('403')) {
        throw new Error('Authentication failed. Please check your Azure DevOps PAT and permissions.');
      }
      if (error.message?.includes('404')) {
        throw new Error('Organization not found. Please check your Azure DevOps organization URL.');
      }
      throw new Error('Failed to fetch projects. Please try again later.');
    }
  }

  async getRepositories(projectName: string): Promise<AzureRepository[]> {
    try {
      // console.log(`Fetching repositories for project: ${projectName} via Supabase Edge Function...`);
      const response = await this.callEdgeFunction('repositories', {
        project: projectName
      });
      
      if (response && response.value) {
        // console.log(`Found ${response.value.length} repositories in project ${projectName}`);
        return response.value;
      }
      // console.log(`No repositories found for project ${projectName}`);
      return [];
    } catch (error) {
      console.error(`Error fetching repositories for project ${projectName}:`, error);
      if (error.message?.includes('401') || error.message?.includes('403')) {
        throw new Error('Authentication failed. Please check your Azure DevOps PAT and permissions.');
      }
      if (error.message?.includes('404')) {
        throw new Error(`Project ${projectName} not found. Please check the project name.`);
      }
      throw new Error(`Failed to fetch repositories for project ${projectName}. Please try again later.`);
    }
  }

  async listFiles(projectName: string, repositoryId: string): Promise<string[]> {
    try {
      const response = await this.callEdgeFunction('listFiles', {
        project: projectName,
        repositoryId
      });
      
      if (response && Array.isArray(response.files)) {
        // console.log(`Found ${response.files.length} files in repository`);
        return response.files;
      }
      return [];
    } catch (error) {
      console.error('Error listing files:', error);
      return [];
    }
  }

  async getFileContent(projectName: string, repositoryId: string, filePath: string): Promise<string | null> {
    try {
      // console.log(`Fetching file content for: ${filePath}`);
      const response = await this.callEdgeFunction('fileContent', {
        project: projectName,
        repositoryId,
        filePath
      });
      
      if (response && response.content) {
        // console.log(`Successfully fetched content for: ${filePath}`);
        return response.content;
      }
      
      // console.log(`No content found for: ${filePath}`);
      return null;
    } catch (error) {
      console.error(`Error fetching file content for ${filePath}:`, error);
      if (error.message?.includes('404')) {
        console.log(`File not found: ${filePath}`);
      } else if (error.message?.includes('401') || error.message?.includes('403')) {
        console.error('Authentication failed. Please check your Azure DevOps PAT and permissions.');
      }
      return null;
    }
  }

  async createBranch(projectName: string, repositoryId: string, branchName: string, sourceBranch: string): Promise<boolean> {
    try {
      // console.log(`Creating branch ${branchName} from ${sourceBranch}...`);
      const response = await this.callEdgeFunction('createBranch', {
        project: projectName,
        repositoryId,
        branchName,
        sourceBranch
      });
      
      const success = response && response.success;
      // console.log(`Branch creation ${success ? 'successful' : 'failed'}`);
      return success;
    } catch (error) {
      console.error('Error creating branch:', error);
      return false;
    }
  }

  async commitFiles(
    projectName: string, 
    repositoryId: string, 
    branchName: string, 
    files: Array<{path: string, content: string}>, 
    message: string,
    migrationRules?: MigrationRules
  ): Promise<boolean> {
    try {
      console.log('=== COMMITTING FILES WITH MIGRATION RULES PRIORITY ===');
      console.log(`Committing ${files.length} files to branch ${branchName}...`);
      console.log('Migration Rules being sent to Azure DevOps:', migrationRules);
      
      const response = await this.callEdgeFunction('commitFiles', {
        project: projectName,
        repositoryId,
        branchName,
        files,
        message,
        migrationRules // Pass migration rules to edge function
      });
      
      const success = response && response.success;
      console.log(`File commit ${success ? 'successful' : 'failed'} with rules priority`);
      return success;
    } catch (error) {
      console.error('Error committing files with migration rules:', error);
      return false;
    }
  }

  // Enhanced method to discover and categorize files
  async discoverProjectFiles(projectName: string, repositoryId: string): Promise<{
    pomPaths: string[];
    artifactJsonPaths: string[];
    projectXmlPaths: string[];
  }> {
    // console.log('Discovering project files for Azure DevOps repository...');
    
    const pomPaths: string[] = [];
    const artifactJsonPaths: string[] = [];
    const projectXmlPaths: string[] = [];

    try {
      const allFiles = await this.listFiles(projectName, repositoryId);
      // console.log(`Analyzing ${allFiles.length} files for Mule artifacts...`);

      allFiles.forEach(filePath => {
        if (filePath.endsWith('pom.xml')) {
          pomPaths.push(filePath);
          // console.log(`Found POM file: ${filePath}`);
        } else if (filePath.endsWith('mule-artifact.json')) {
          artifactJsonPaths.push(filePath);
          // console.log(`Found artifact JSON file: ${filePath}`);
        } else if (filePath.endsWith('.xml') && filePath.includes('src/main/mule/')) {
          projectXmlPaths.push(filePath);
          // console.log(`Found project XML file: ${filePath}`);
        }
      });
    } catch (error) {
      console.error('Error discovering project files:', error);
    }

    console.log('File discovery results:', { pomPaths, artifactJsonPaths, projectXmlPaths });
    return { pomPaths, artifactJsonPaths, projectXmlPaths };
  }
}

export const createAzureDevOpsAPI = (organization: string, token: string) => {
  return new AzureDevOpsAPI(organization, token);
};
