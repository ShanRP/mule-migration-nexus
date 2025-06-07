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

// Helper to detect if string is base64 encoded
function isBase64(str: string): boolean {
  try {
    // Check if string contains only valid base64 characters
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    if (!base64Regex.test(str)) {
      return false;
    }
    
    // Try to decode - if it works and re-encoding gives same result, it's base64
    const decoded = atob(str);
    const reencoded = btoa(decoded);
    return reencoded === str;
  } catch {
    return false;
  }
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
    
    // Add timeout and better error handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
    const response = await fetch(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/items?recursionLevel=Full&api-version=7.0`,
      { 
        headers: { 
          'Authorization': getAzureAuthHeader(token), 
          'Accept': 'application/json' 
        },
        signal: controller.signal
      }
    );
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`Azure DevOps API error: ${response.status} - ${response.statusText}`);
      
      // Handle specific error cases
      if (response.status === 404) {
        console.log(`Repository ${repositoryId} not found or no access`);
        return new Response(JSON.stringify({ files: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } else if (response.status === 403) {
        console.log(`Access denied to repository ${repositoryId}`);
        return new Response(JSON.stringify({ files: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } else if (response.status === 500) {
        console.log(`Server error for repository ${repositoryId}, returning empty files`);
        return new Response(JSON.stringify({ files: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
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
    
    // Return empty files instead of throwing error to prevent breaking the entire process
    if (error.name === 'AbortError') {
      console.log(`Timeout occurred for repository ${repositoryId}`);
    }
    
    return new Response(JSON.stringify({ files: [] }), {
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
    
    // Use the direct file content API with proper encoding handling
    const encodedPath = encodeURIComponent('/' + filePath);
    const endpoint = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/items?path=${encodedPath}&includeContent=true&api-version=7.0`;
    
    console.log(`Fetching from endpoint: ${endpoint}`);
    
    // Add timeout for file content requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
    
    const response = await fetch(endpoint, { 
      headers: { 
        'Authorization': getAzureAuthHeader(token), 
        'Accept': 'application/json'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      if (response.status === 404) {
        console.log(`File not found: ${filePath}`);
        return new Response(JSON.stringify({ content: null }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.error(`Azure DevOps API error: ${response.status} - ${response.statusText}`);
      throw new Error(`Azure DevOps API error: ${response.status}`);
    }

    const data = await response.json();
    console.log(`Response data keys:`, Object.keys(data || {}));
    
    // Check if we have content in the response
    if (data && data.content) {
      console.log(`Raw content type: ${typeof data.content}, length: ${data.content.length}`);
      console.log(`First 100 chars of content:`, data.content.substring(0, 100));
      
      let content: string;
      
      // Smart content decoding - check if it's actually base64
      if (isBase64(data.content)) {
        try {
          content = atob(data.content);
          console.log(`Successfully decoded base64 content for: ${filePath} (${content.length} characters)`);
        } catch (decodeError) {
          console.error(`Base64 decode failed for ${filePath}:`, decodeError);
          // If base64 decode fails, use content as-is
          content = data.content;
          console.log(`Using content as-is for: ${filePath}`);
        }
      } else {
        // Content is already plain text
        content = data.content;
        console.log(`Content is plain text for: ${filePath} (${content.length} characters)`);
      }
      
      return new Response(JSON.stringify({ content }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } else if (data && data.url) {
      // If no direct content but we have a URL, try fetching from the download URL
      console.log(`No direct content, trying download URL: ${data.url}`);
      
      const downloadResponse = await fetch(data.url, {
        headers: { 
          'Authorization': getAzureAuthHeader(token),
          'Accept': 'text/plain, application/xml, application/json, */*'
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
    
    console.log(`No content found for: ${filePath}`);
    return new Response(JSON.stringify({ content: null }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error(`Error fetching file content for ${filePath}:`, error);
    
    // Return null content instead of throwing error
    if (error.name === 'AbortError') {
      console.log(`Timeout occurred for file ${filePath}`);
    }
    
    return new Response(JSON.stringify({ content: null }), {
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
  const { organization, project, repositoryId, branchName, files, message, token } = body;
  if (!organization || !project || !repositoryId || !branchName || !files || !message || !token) {
    return new Response(JSON.stringify({ error: 'Missing params' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  
  if (!Array.isArray(files) || files.length === 0) {
    return new Response(JSON.stringify({ error: 'Files array is empty or invalid' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  
  try {
    console.log(`Committing ${files.length} files to branch ${branchName} in repository ${repositoryId}`);
    console.log('Files to commit:', files.map((f: any) => f.path));
    
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
    
    // Prepare changes for commit - Azure DevOps expects the correct change type
    const changes = files.map((file: any) => ({
      changeType: 'edit', // Use 'edit' for existing files, 'add' for new files
      item: { path: `/${file.path}` },
      newContent: {
        content: btoa(file.content), // Base64 encode content
        contentType: 'base64encoded'
      }
    }));
    
    // Correct payload structure for Azure DevOps pushes API
    const commitPayload = {
      refUpdates: [
        {
          name: `refs/heads/${branchName}`,
          oldObjectId: oldObjectId, // Use the current commit ID instead of zeros
        }
      ],
      commits: [
        {
          comment: message,
          changes: changes
        }
      ]
    };
    
    console.log('Commit payload structure:', JSON.stringify(commitPayload, null, 2));
    
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
      console.error('Commit failed:', errorText);
      throw new Error(`Failed to commit files: ${commitResponse.status} - ${errorText}`);
    }
    
    const commitData = await commitResponse.json();
    console.log('Commit response:', commitData);
    console.log('Files committed successfully');
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error committing files:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
