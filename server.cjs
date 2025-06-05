
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

// Helper to build Azure DevOps auth header
function getAzureAuthHeader(token) {
  return 'Basic ' + Buffer.from(':' + token).toString('base64');
}

const app = express();
app.use(cors());
app.use(express.json());

// Proxy: Get Azure DevOps projects
app.post('/api/azure/projects', async (req, res) => {
  const { organization, token } = req.body;
  if (!organization || !token) return res.status(400).json({ error: 'Missing organization or token' });
  try {
    const response = await axios.get(
      `https://dev.azure.com/${organization}/_apis/projects?api-version=7.0`,
      { headers: { 'Authorization': getAzureAuthHeader(token), 'Accept': 'application/json' } }
    );
    res.json(response.data);
  } catch (err) {
    console.error('Projects API error:', err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// Proxy: Get Azure DevOps repositories for a project
app.post('/api/azure/repositories', async (req, res) => {
  const { organization, project, token } = req.body;
  if (!organization || !project || !token) return res.status(400).json({ error: 'Missing params' });
  try {
    const response = await axios.get(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories?api-version=7.0`,
      { headers: { 'Authorization': getAzureAuthHeader(token), 'Accept': 'application/json' } }
    );
    res.json(response.data);
  } catch (err) {
    console.error('Repositories API error:', err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// List files in a repository
app.post('/api/azure/listFiles', async (req, res) => {
  const { organization, project, repositoryId, token } = req.body;
  if (!organization || !project || !repositoryId || !token) return res.status(400).json({ error: 'Missing params' });
  try {
    const response = await axios.get(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/items?recursionLevel=Full&api-version=7.0`,
      { headers: { 'Authorization': getAzureAuthHeader(token), 'Accept': 'application/json' } }
    );
    if (response.data && response.data.value) {
      const files = response.data.value
        .filter(item => !item.isFolder && item.path && !item.path.includes('/target/'))
        .map(item => item.path.substring(1));
      res.json({ files });
    } else {
      res.json({ files: [] });
    }
  } catch (err) {
    console.error('List files API error:', err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// Get file content - Enhanced with better error handling
app.post('/api/azure/fileContent', async (req, res) => {
  const { organization, project, repositoryId, filePath, token } = req.body;
  if (!organization || !project || !repositoryId || !filePath || !token) return res.status(400).json({ error: 'Missing params' });
  try {
    console.log(`Fetching file content: ${filePath}`);
    const response = await axios.get(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/items?path=${encodeURIComponent('/' + filePath)}&api-version=7.0`,
      { headers: { 'Authorization': getAzureAuthHeader(token), 'Accept': 'text/plain' } }
    );
    console.log(`Successfully fetched file content for: ${filePath}`);
    res.json({ content: response.data });
  } catch (err) {
    console.error(`File content API error for ${filePath}:`, err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// Create branch - Enhanced error handling and validation
app.post('/api/azure/createBranch', async (req, res) => {
  const { organization, project, repositoryId, branchName, sourceBranch, token } = req.body;
  if (!organization || !project || !repositoryId || !branchName || !sourceBranch || !token) return res.status(400).json({ error: 'Missing params' });
  try {
    console.log(`Creating branch ${branchName} from ${sourceBranch} in repo ${repositoryId}`);
    
    // Get the source branch commit first
    const branchResponse = await axios.get(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/refs?filter=heads/${sourceBranch}&api-version=7.0`,
      { headers: { 'Authorization': getAzureAuthHeader(token), 'Accept': 'application/json' } }
    );
    
    if (!branchResponse.data || !branchResponse.data.value || branchResponse.data.value.length === 0) {
      console.error(`Source branch ${sourceBranch} not found`);
      return res.json({ success: false, error: `Source branch ${sourceBranch} not found` });
    }
    
    const sourceCommitId = branchResponse.data.value[0].objectId;
    console.log(`Source commit ID: ${sourceCommitId}`);
    
    // Create new branch with correct API format
    const createBranchPayload = [
      {
        name: `refs/heads/${branchName}`,
        oldObjectId: '0000000000000000000000000000000000000000',
        newObjectId: sourceCommitId
      }
    ];
    
    await axios.post(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/refs?api-version=7.0`,
      createBranchPayload,
      { 
        headers: { 
          'Authorization': getAzureAuthHeader(token), 
          'Content-Type': 'application/json',
          'Accept': 'application/json' 
        } 
      }
    );
    
    console.log(`Successfully created branch ${branchName}`);
    res.json({ success: true });
  } catch (err) {
    if (err.response && err.response.status === 409) {
      // Branch already exists
      console.log(`Branch ${branchName} already exists`);
      return res.json({ success: true });
    }
    console.error('Branch creation error:', err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ 
      success: false, 
      error: `Failed to create branch: ${err.response?.data?.message || err.message}` 
    });
  }
});

// Commit files - Enhanced error handling and validation
app.post('/api/azure/commitFiles', async (req, res) => {
  const { organization, project, repositoryId, branchName, files, message, token } = req.body;
  if (!organization || !project || !repositoryId || !branchName || !files || !message || !token) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }
  
  try {
    console.log(`Committing ${files.length} files to branch ${branchName}`);
    
    // Validate files array
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'Files array is required and must not be empty' });
    }
    
    // Validate each file object
    for (const file of files) {
      if (!file.path || !file.content) {
        return res.status(400).json({ error: 'Each file must have path and content properties' });
      }
    }
    
    // Get the latest commit on the branch
    const branchResponse = await axios.get(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/refs?filter=heads/${branchName}&api-version=7.0`,
      { headers: { 'Authorization': getAzureAuthHeader(token), 'Accept': 'application/json' } }
    );
    
    if (!branchResponse.data || !branchResponse.data.value || branchResponse.data.value.length === 0) {
      console.error(`Branch ${branchName} not found`);
      return res.json({ success: false, error: `Branch ${branchName} not found. Please ensure the branch exists.` });
    }
    
    const branchObjectId = branchResponse.data.value[0].objectId;
    console.log(`Current branch commit ID: ${branchObjectId}`);
    
    // Prepare changes array
    const changes = files.map(file => ({
      changeType: 'edit',
      item: { path: `/${file.path}` },
      newContent: { content: file.content, contentType: 'rawtext' }
    }));
    
    const pushPayload = {
      refUpdates: [{ name: `refs/heads/${branchName}`, oldObjectId: branchObjectId }],
      commits: [{ comment: message, changes }]
    };
    
    console.log('Pushing changes to Azure DevOps...');
    const pushResponse = await axios.post(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/pushes?api-version=7.0`,
      pushPayload,
      { 
        headers: { 
          'Authorization': getAzureAuthHeader(token), 
          'Content-Type': 'application/json',
          'Accept': 'application/json' 
        } 
      }
    );
    
    console.log('Successfully committed files');
    res.json({ success: true, pushId: pushResponse.data?.pushId });
  } catch (err) {
    console.error('Commit files error:', err.response?.data || err.message);
    
    let errorMessage = 'Failed to commit files.';
    
    if (err.response?.status === 401 || err.response?.status === 403) {
      errorMessage = 'Insufficient permissions to commit files. Please ensure your PAT has Code (read & write) permissions and Project and team (read) permissions.';
    } else if (err.response?.data?.message) {
      errorMessage = `Commit failed: ${err.response.data.message}`;
    } else if (err.message) {
      errorMessage = `Commit failed: ${err.message}`;
    }
    
    res.status(err.response?.status || 500).json({ 
      success: false, 
      error: errorMessage 
    });
  }
});

const PORT = process.env.PORT || 3031;
app.listen(PORT, () => console.log(`Azure DevOps proxy listening on port ${PORT}`));
