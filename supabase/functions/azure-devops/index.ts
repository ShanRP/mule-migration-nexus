
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper to build Azure DevOps auth header
function getAzureAuthHeader(token: string) {
  return 'Basic ' + btoa(':' + token);
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { endpoint, organization, token, ...requestData } = body;

    console.log(`Azure DevOps API request: ${endpoint}`, { organization, requestData });

    if (!organization || !token) {
      return new Response(JSON.stringify({ error: 'Missing organization or token' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Route to appropriate handler based on endpoint
    if (endpoint === 'projects') {
      return await handleProjects({ organization, token });
    } else if (endpoint === 'repositories') {
      return await handleRepositories({ organization, token, ...requestData });
    } else if (endpoint === 'listFiles') {
      return await handleListFiles({ organization, token, ...requestData });
    } else if (endpoint === 'fileContent') {
      return await handleFileContent({ organization, token, ...requestData });
    } else if (endpoint === 'createBranch') {
      return await handleCreateBranch({ organization, token, ...requestData });
    } else if (endpoint === 'commitFiles') {
      return await handleCommitFiles({ organization, token, ...requestData });
    } else {
      return new Response(JSON.stringify({ error: 'Invalid endpoint' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    console.error('Error in azure-devops function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function handleProjects(body: any) {
  const { organization, token } = body;
  if (!organization || !token) {
    return new Response(JSON.stringify({ error: 'Missing organization or token' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    console.log(`Fetching projects for organization: ${organization}`);
    const response = await fetch(
      `https://dev.azure.com/${organization}/_apis/projects?api-version=7.0`,
      { 
        headers: { 
          'Authorization': getAzureAuthHeader(token), 
          'Accept': 'application/json' 
        } 
      }
    );

    if (!response.ok) {
      throw new Error(`Azure DevOps API error: ${response.status}`);
    }

    const data = await response.json();
    console.log(`Successfully fetched ${data.value?.length || 0} projects`);
    
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error fetching projects:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

async function handleRepositories(body: any) {
  const { organization, project, token } = body;
  if (!organization || !project || !token) {
    return new Response(JSON.stringify({ error: 'Missing params' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    console.log(`Fetching repositories for project: ${project}`);
    const response = await fetch(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories?api-version=7.0`,
      { 
        headers: { 
          'Authorization': getAzureAuthHeader(token), 
          'Accept': 'application/json' 
        } 
      }
    );

    if (!response.ok) {
      throw new Error(`Azure DevOps API error: ${response.status}`);
    }

    const data = await response.json();
    console.log(`Successfully fetched ${data.value?.length || 0} repositories`);
    
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error fetching repositories:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

async function handleListFiles(body: any) {
  const { organization, project, repositoryId, token } = body;
  if (!organization || !project || !repositoryId || !token) {
    return new Response(JSON.stringify({ error: 'Missing params' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    console.log(`Listing files for repository: ${repositoryId} in project: ${project}`);
    const response = await fetch(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/items?recursionLevel=Full&api-version=7.0`,
      { 
        headers: { 
          'Authorization': getAzureAuthHeader(token), 
          'Accept': 'application/json' 
        } 
      }
    );

    if (!response.ok) {
      console.error(`Azure DevOps API error: ${response.status} - ${response.statusText}`);
      throw new Error(`Azure DevOps API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data && data.value) {
      const files = data.value
        .filter((item: any) => !item.isFolder && item.path && !item.path.includes('/target/'))
        .map((item: any) => item.path.substring(1)); // Remove leading slash
      
      console.log(`Found ${files.length} files (excluding folders and target directories)`);
      
      // Log Mule-specific files for debugging
      const muleFiles = files.filter((file: string) => 
        file.endsWith('pom.xml') || 
        file.endsWith('mule-artifact.json') || 
        (file.endsWith('.xml') && file.includes('src/main/mule/'))
      );
      console.log(`Found ${muleFiles.length} Mule-related files:`, muleFiles);
      
      return new Response(JSON.stringify({ files }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } else {
      console.log('No files found in repository');
      return new Response(JSON.stringify({ files: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    console.error('Error listing files:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

async function handleFileContent(body: any) {
  const { organization, project, repositoryId, filePath, token } = body;
  if (!organization || !project || !repositoryId || !filePath || !token) {
    return new Response(JSON.stringify({ error: 'Missing params' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    console.log(`Fetching content for file: ${filePath}`);
    
    // Try different API endpoints and content types
    const endpoints = [
      // First try with includeContent=true
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/items?path=${encodeURIComponent('/' + filePath)}&includeContent=true&api-version=7.0`,
      // Fallback to basic endpoint
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/items?path=${encodeURIComponent('/' + filePath)}&api-version=7.0`
    ];

    for (const endpoint of endpoints) {
      console.log(`Trying endpoint: ${endpoint}`);
      
      const response = await fetch(endpoint, { 
        headers: { 
          'Authorization': getAzureAuthHeader(token), 
          'Accept': 'application/json'
        },
      });
      
      if (!response.ok) {
        if (response.status === 404) {
          console.log(`File not found: ${filePath}`);
          continue; // Try next endpoint
        }
        console.error(`Azure DevOps API error: ${response.status} - ${response.statusText}`);
        continue; // Try next endpoint
      }

      const data = await response.json();
      console.log(`Response data keys:`, Object.keys(data || {}));
      
      // Check if we have content in the response
      if (data && data.content) {
        try {
          console.log(`Raw content type: ${typeof data.content}, first 100 chars:`, data.content.substring(0, 100));
          
          // Try to decode base64 content
          const content = atob(data.content);
          console.log(`Successfully decoded content for: ${filePath} (${content.length} characters)`);
          
          return new Response(JSON.stringify({ content }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } catch (decodeError) {
          console.error(`Error decoding content for ${filePath}:`, decodeError);
          console.log(`Trying to return content as-is`);
          
          // If base64 decode fails, try returning content as-is
          return new Response(JSON.stringify({ content: data.content }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } else if (data && data.url) {
        // If no content but we have a URL, try fetching from the download URL
        console.log(`No direct content, trying download URL: ${data.url}`);
        
        const downloadResponse = await fetch(data.url, {
          headers: { 
            'Authorization': getAzureAuthHeader(token),
            'Accept': 'text/plain, application/xml, */*'
          },
        });
        
        if (downloadResponse.ok) {
          const content = await downloadResponse.text();
          console.log(`Successfully fetched content via download URL for: ${filePath} (${content.length} characters)`);
          
          return new Response(JSON.stringify({ content }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } else {
          console.error(`Download URL failed: ${downloadResponse.status} - ${downloadResponse.statusText}`);
        }
      }
    }
    
    console.log(`No content found for: ${filePath} after trying all endpoints`);
    return new Response(JSON.stringify({ content: null }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error(`Error fetching file content for ${filePath}:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

async function handleCreateBranch(body: any) {
  const { organization, project, repositoryId, branchName, sourceBranch, token } = body;
  if (!organization || !project || !repositoryId || !branchName || !sourceBranch || !token) {
    return new Response(JSON.stringify({ error: 'Missing params' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    console.log(`Creating branch ${branchName} from ${sourceBranch} in repository ${repositoryId}`);
    
    // Get the source branch commit first
    const branchResponse = await fetch(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/refs?filter=heads/${sourceBranch}&api-version=7.0`,
      { 
        headers: { 
          'Authorization': getAzureAuthHeader(token), 
          'Accept': 'application/json' 
        } 
      }
    );
    
    if (!branchResponse.ok) {
      throw new Error(`Failed to get source branch: ${branchResponse.status}`);
    }

    const branchData = await branchResponse.json();
    
    if (!branchData || !branchData.value || branchData.value.length === 0) {
      console.error(`Source branch ${sourceBranch} not found`);
      return new Response(JSON.stringify({ success: false, error: 'Source branch not found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const sourceCommitId = branchData.value[0].objectId;
    console.log(`Source branch commit ID: ${sourceCommitId}`);
    
    // Create new branch with correct API format
    const createBranchPayload = [
      {
        name: `refs/heads/${branchName}`,
        oldObjectId: '0000000000000000000000000000000000000000',
        newObjectId: sourceCommitId
      }
    ];
    
    const createResponse = await fetch(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/refs?api-version=7.0`,
      { 
        method: 'POST',
        headers: { 
          'Authorization': getAzureAuthHeader(token), 
          'Content-Type': 'application/json',
          'Accept': 'application/json' 
        },
        body: JSON.stringify(createBranchPayload)
      }
    );
    
    if (!createResponse.ok) {
      if (createResponse.status === 409) {
        // Branch already exists
        console.log(`Branch ${branchName} already exists`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Failed to create branch: ${createResponse.status}`);
    }
    
    console.log(`Successfully created branch: ${branchName}`);
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Branch creation error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

async function handleCommitFiles(body: any) {
  const { organization, project, repositoryId, branchName, files, message, token, migrationRules } = body;
  
  console.log('=== AZURE DEVOPS EDGE FUNCTION: COMMIT WITH RULES PRIORITY ===');
  console.log('Migration Rules received in edge function:', migrationRules);
  console.log('Files to commit:', files?.length);
  
  if (!organization || !project || !repositoryId || !branchName || !files || !message || !token) {
    console.error('Missing required parameters:', { organization, project, repositoryId, branchName, filesCount: files?.length, message, hasToken: !!token });
    return new Response(JSON.stringify({ error: 'Missing params' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  
  if (!Array.isArray(files) || files.length === 0) {
    console.error('Files array is empty or invalid:', files);
    return new Response(JSON.stringify({ error: 'Files array is empty or invalid' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  
  try {
    console.log(`=== COMMITTING ${files.length} FILES WITH MIGRATION RULES PRIORITY ===`);
    console.log(`Repository: ${repositoryId}, Branch: ${branchName}, Project: ${project}`);
    console.log('Active Migration Rules (ABSOLUTE PRIORITY):', migrationRules);
    console.log('Files being committed:', files.map((f: any) => f.path));
    
    // Get the latest commit on the branch
    const branchResponse = await fetch(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/refs?filter=heads/${branchName}&api-version=7.0`,
      { 
        headers: { 
          'Authorization': getAzureAuthHeader(token), 
          'Accept': 'application/json' 
        } 
      }
    );
    
    if (!branchResponse.ok) {
      console.error(`Failed to get branch info: ${branchResponse.status} - ${branchResponse.statusText}`);
      throw new Error(`Failed to get branch info: ${branchResponse.status}`);
    }

    const branchData = await branchResponse.json();
    
    if (!branchData || !branchData.value || branchData.value.length === 0) {
      console.error(`Branch ${branchName} not found`);
      return new Response(JSON.stringify({ success: false, error: 'Branch not found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const oldObjectId = branchData.value[0].objectId;
    console.log(`Current branch commit ID: ${oldObjectId}`);
    
    // Log migration rules application
    if (migrationRules) {
      console.log('=== MIGRATION RULES BEING APPLIED (HIGHEST PRIORITY) ===');
      console.log('Java Version (Rules):', migrationRules.javaVersion);
      console.log('Mule Version (Rules):', migrationRules.muleVersion);
      console.log('Min Mule Version (Rules):', migrationRules.minMuleVersion);
      console.log('Dependency Versions (Rules):', migrationRules.dependencyVersions);
      console.log('Connector Replacements (Rules):', migrationRules.connectorReplacements);
      
      // Process files with migration rules priority
      files.forEach((file: any) => {
        console.log(`Processing file with rules priority: ${file.path}`);
        
        // If it's a POM file, log dependency rule applications
        if (file.path.endsWith('pom.xml') && migrationRules.dependencyVersions?.length > 0) {
          console.log(`POM file ${file.path} - applying dependency rules:`, migrationRules.dependencyVersions);
        }
        
        // If it's an artifact JSON file, log runtime rule applications
        if (file.path.endsWith('mule-artifact.json')) {
          console.log(`Artifact JSON file ${file.path} - applying runtime rules:`);
          console.log(`- Java Version Rule: ${migrationRules.javaVersion}`);
          console.log(`- Min Mule Version Rule: ${migrationRules.minMuleVersion}`);
        }
        
        // If it's an XML file, log connector rule applications
        if (file.path.endsWith('.xml') && file.path.includes('src/main/mule/') && migrationRules.connectorReplacements?.length > 0) {
          console.log(`Mule XML file ${file.path} - applying connector rules:`, migrationRules.connectorReplacements);
        }
      });
    } else {
      console.warn('No migration rules received - using default migration behavior');
    }
    
    // Prepare changes for commit - Azure DevOps expects the correct change type
    const changes = files.map((file: any) => {
      console.log(`Preparing commit for file: ${file.path} (${file.content.length} characters)`);
      return {
        changeType: 'edit', // Use 'edit' for existing files, 'add' for new files
        item: { path: `/${file.path}` },
        newContent: {
          content: btoa(file.content), // Base64 encode content
          contentType: 'base64encoded'
        }
      };
    });
    
    // Include migration rules in commit message for audit trail
    const commitMessage = migrationRules 
      ? `${message} | Rules Priority Applied: Java=${migrationRules.javaVersion}, Mule=${migrationRules.muleVersion}, MinMule=${migrationRules.minMuleVersion}`
      : message;
    
    console.log('Enhanced commit message with rules info:', commitMessage);
    
    // Correct payload structure for Azure DevOps pushes API
    const commitPayload = {
      refUpdates: [
        {
          name: `refs/heads/${branchName}`,
          oldObjectId: oldObjectId,
        }
      ],
      commits: [
        {
          comment: commitMessage,
          changes: changes
        }
      ]
    };
    
    console.log('Commit payload with migration rules context prepared');
    
    const commitResponse = await fetch(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/pushes?api-version=7.0`,
      {
        method: 'POST',
        headers: {
          'Authorization': getAzureAuthHeader(token),
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(commitPayload)
      }
    );
    
    if (!commitResponse.ok) {
      const errorText = await commitResponse.text();
      console.error('Commit failed with migration rules:', errorText);
      throw new Error(`Failed to commit files with migration rules: ${commitResponse.status} - ${errorText}`);
    }
    
    const commitData = await commitResponse.json();
    console.log('=== COMMIT SUCCESSFUL WITH MIGRATION RULES PRIORITY ===');
    console.log('Commit response:', commitData);
    console.log('Migration rules were successfully applied with highest priority');
    
    return new Response(JSON.stringify({ 
      success: true, 
      rulesApplied: !!migrationRules,
      migrationRules: migrationRules 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error committing files with migration rules:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
