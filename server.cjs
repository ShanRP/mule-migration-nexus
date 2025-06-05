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

// Get file content
app.post('/api/azure/fileContent', async (req, res) => {
  const { organization, project, repositoryId, filePath, token } = req.body;
  if (!organization || !project || !repositoryId || !filePath || !token) return res.status(400).json({ error: 'Missing params' });
  try {
    const response = await axios.get(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/items?path=${encodeURIComponent('/' + filePath)}&api-version=7.0`,
      { headers: { 'Authorization': getAzureAuthHeader(token), 'Accept': 'text/plain' } }
    );
    res.json({ content: response.data });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// Create branch
app.post('/api/azure/createBranch', async (req, res) => {
  const { organization, project, repositoryId, branchName, sourceBranch, token } = req.body;
  if (!organization || !project || !repositoryId || !branchName || !sourceBranch || !token) return res.status(400).json({ error: 'Missing params' });
  try {
    // Get the source branch commit first
    const branchResponse = await axios.get(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/refs?filter=heads/${sourceBranch}&api-version=7.0`,
      { headers: { 'Authorization': getAzureAuthHeader(token), 'Accept': 'application/json' } }
    );
    if (!branchResponse.data || !branchResponse.data.value || branchResponse.data.value.length === 0) {
      return res.json({ success: false, error: 'Source branch not found' });
    }
    const sourceCommitId = branchResponse.data.value[0].objectId;
    // Create new branch
    await axios.post(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/refs?api-version=7.0`,
      [
        {
          name: `refs/heads/${branchName}`,
          oldObjectId: '0000000000000000000000000000000000000000',
          newObjectId: sourceCommitId
        }
      ],
      { headers: { 'Authorization': getAzureAuthHeader(token), 'Accept': 'application/json' } }
    );
    res.json({ success: true });
  } catch (err) {
    if (err.response && err.response.status === 409) {
      // Branch already exists
      return res.json({ success: true });
    }
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// Commit files
app.post('/api/azure/commitFiles', async (req, res) => {
  const { organization, project, repositoryId, branchName, files, message, token } = req.body;
  if (!organization || !project || !repositoryId || !branchName || !files || !message || !token) return res.status(400).json({ error: 'Missing params' });
  try {
    // Get the latest commit on the branch
    const branchResponse = await axios.get(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/refs?filter=heads/${branchName}&api-version=7.0`,
      { headers: { 'Authorization': getAzureAuthHeader(token), 'Accept': 'application/json' } }
    );
    if (!branchResponse.data || !branchResponse.data.value || branchResponse.data.value.length === 0) {
      return res.json({ success: false, error: 'Branch not found' });
    }
    const branchObjectId = branchResponse.data.value[0].objectId;
    const changes = files.map(file => ({
      changeType: 'edit',
      item: { path: `/${file.path}` },
      newContent: { content: file.content, contentType: 'rawtext' }
    }));
    await axios.post(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/pushes?api-version=7.0`,
      {
        refUpdates: [{ name: `refs/heads/${branchName}`, oldObjectId: branchObjectId }],
        commits: [{ comment: message, changes }]
      },
      { headers: { 'Authorization': getAzureAuthHeader(token), 'Accept': 'application/json' } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3031;
app.listen(PORT, () => console.log(`Azure DevOps proxy listening on port ${PORT}`));
