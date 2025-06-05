
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
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// Get file content - Fixed to always return string content
app.post('/api/azure/fileContent', async (req, res) => {
  const { organization, project, repositoryId, filePath, token } = req.body;
  if (!organization || !project || !repositoryId || !filePath || !token) return res.status(400).json({ error: 'Missing params' });
  try {
    console.log(`Fetching file content for: ${filePath}`);
    const response = await axios.get(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/items?path=${encodeURIComponent('/' + filePath)}&api-version=7.0`,
      { headers: { 'Authorization': getAzureAuthHeader(token), 'Accept': 'text/plain' } }
    );
    
    // Ensure we always return a string
    let content = response.data;
    if (typeof content !== 'string') {
      content = String(content);
    }
    
    console.log(`File content type: ${typeof content}, length: ${content.length}`);
    res.json({ content });
  } catch (err) {
    console.error(`Error fetching file ${filePath}:`, err.message);
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// Create branch - Fixed API call with proper repository reference
app.post('/api/azure/createBranch', async (req, res) => {
  const { organization, project, repositoryId, branchName, sourceBranch, token } = req.body;
  if (!organization || !project || !repositoryId || !branchName || !sourceBranch || !token) return res.status(400).json({ error: 'Missing params' });
  try {
    console.log(`Creating branch ${branchName} from ${sourceBranch} in repo ${repositoryId}`);
    
    // First, get the source branch commit
    const branchResponse = await axios.get(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/refs?filter=heads/${sourceBranch}&api-version=7.0`,
      { headers: { 'Authorization': getAzureAuthHeader(token), 'Accept': 'application/json' } }
    );
    
    if (!branchResponse.data || !branchResponse.data.value || branchResponse.data.value.length === 0) {
      console.error(`Source branch ${sourceBranch} not found`);
      return res.json({ success: false, error: 'Source branch not found' });
    }
    
    const sourceCommitId = branchResponse.data.value[0].objectId;
    console.log(`Source commit ID: ${sourceCommitId}`);
    
    // Create new branch with correct format
    const createBranchPayload = [
      {
        name: `refs/heads/${branchName}`,
        oldObjectId: '0000000000000000000000000000000000000000',
        newObjectId: sourceCommitId
      }
    ];
    
    console.log('Creating branch with payload:', createBranchPayload);
    
    const createResponse = await axios.post(
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
    
    console.log('Branch creation successful:', createResponse.status);
    res.json({ success: true });
  } catch (err) {
    console.error('Branch creation error details:', {
      status: err.response?.status,
      data: err.response?.data,
      message: err.message
    });
    
    if (err.response && err.response.status === 409) {
      // Branch already exists
      console.log('Branch already exists, continuing...');
      return res.json({ success: true });
    }
    res.status(err.response?.status || 500).json({ error: err.message, details: err.response?.data });
  }
});

// Commit files - Improved error handling and logging
app.post('/api/azure/commitFiles', async (req, res) => {
  const { organization, project, repositoryId, branchName, files, message, token } = req.body;
  if (!organization || !project || !repositoryId || !branchName || !files || !message || !token) return res.status(400).json({ error: 'Missing params' });
  try {
    console.log(`Committing ${files.length} files to branch ${branchName}`);
    
    // Get the latest commit on the branch
    const branchResponse = await axios.get(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/refs?filter=heads/${branchName}&api-version=7.0`,
      { headers: { 'Authorization': getAzureAuthHeader(token), 'Accept': 'application/json' } }
    );
    
    if (!branchResponse.data || !branchResponse.data.value || branchResponse.data.value.length === 0) {
      console.error(`Branch ${branchName} not found for commit`);
      return res.json({ success: false, error: 'Branch not found' });
    }
    
    const branchObjectId = branchResponse.data.value[0].objectId;
    console.log(`Branch ${branchName} object ID: ${branchObjectId}`);
    
    const changes = files.map(file => ({
      changeType: 'edit',
      item: { path: `/${file.path}` },
      newContent: { content: file.content, contentType: 'rawtext' }
    }));
    
    const pushPayload = {
      refUpdates: [{ name: `refs/heads/${branchName}`, oldObjectId: branchObjectId }],
      commits: [{ comment: message, changes }]
    };
    
    console.log('Committing with payload:', JSON.stringify(pushPayload, null, 2));
    
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
    
    console.log('Commit successful:', pushResponse.status);
    res.json({ success: true });
  } catch (err) {
    console.error('Commit files error details:', {
      status: err.response?.status,
      data: err.response?.data,
      message: err.message
    });
    res.status(err.response?.status || 500).json({ error: err.message, details: err.response?.data });
  }
});

const PORT = process.env.PORT || 3031;
app.listen(PORT, () => console.log(`Azure DevOps proxy listening on port ${PORT}`));
