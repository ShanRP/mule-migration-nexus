require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

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
    console.log(`Fetching projects for organization: ${organization}`);
    const response = await axios.get(
      `https://dev.azure.com/${organization}/_apis/projects?api-version=7.0`,
      { headers: { 'Authorization': getAzureAuthHeader(token), 'Accept': 'application/json' } }
    );
    console.log(`Successfully fetched ${response.data.value?.length || 0} projects`);
    res.json(response.data);
  } catch (err) {
    console.error('Error fetching projects:', err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// Proxy: Get Azure DevOps repositories for a project
app.post('/api/azure/repositories', async (req, res) => {
  const { organization, project, token } = req.body;
  if (!organization || !project || !token) return res.status(400).json({ error: 'Missing params' });
  try {
    console.log(`Fetching repositories for project: ${project}`);
    const response = await axios.get(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories?api-version=7.0`,
      { headers: { 'Authorization': getAzureAuthHeader(token), 'Accept': 'application/json' } }
    );
    console.log(`Successfully fetched ${response.data.value?.length || 0} repositories`);
    res.json(response.data);
  } catch (err) {
    console.error('Error fetching repositories:', err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// Enhanced list files endpoint with better filtering
app.post('/api/azure/listFiles', async (req, res) => {
  const { organization, project, repositoryId, token } = req.body;
  if (!organization || !project || !repositoryId || !token) return res.status(400).json({ error: 'Missing params' });
  try {
    console.log(`Listing files for repository: ${repositoryId} in project: ${project}`);
    const response = await axios.get(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/items?recursionLevel=Full&api-version=7.0`,
      { headers: { 'Authorization': getAzureAuthHeader(token), 'Accept': 'application/json' } }
    );
    if (response.data && response.data.value) {
      const files = response.data.value
        .filter(item => !item.isFolder && item.path && !item.path.includes('/target/'))
        .map(item => item.path.substring(1)); // Remove leading slash
      
      console.log(`Found ${files.length} files (excluding folders and target directories)`);
      
      // Log Mule-specific files for debugging
      const muleFiles = files.filter(file => 
        file.endsWith('pom.xml') || 
        file.endsWith('mule-artifact.json') || 
        (file.endsWith('.xml') && file.includes('src/main/mule/'))
      );
      console.log(`Found ${muleFiles.length} Mule-related files:`, muleFiles);
      
      res.json({ files });
    } else {
      console.log('No files found in repository');
      res.json({ files: [] });
    }
  } catch (err) {
    console.error('Error listing files:', err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// Enhanced get file content with better error handling
app.post('/api/azure/fileContent', async (req, res) => {
  const { organization, project, repositoryId, filePath, token } = req.body;
  if (!organization || !project || !repositoryId || !filePath || !token) return res.status(400).json({ error: 'Missing params' });
  try {
    console.log(`Fetching content for file: ${filePath}`);
    const response = await axios.get(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/items?path=${encodeURIComponent('/' + filePath)}&api-version=7.0`,
      { 
        headers: { 
          'Authorization': getAzureAuthHeader(token), 
          'Accept': 'text/plain'
        },
        timeout: 30000 // 30 second timeout
      }
    );
    console.log(`Successfully fetched content for: ${filePath} (${response.data.length} characters)`);
    res.json({ content: response.data });
  } catch (err) {
    console.error(`Error fetching file content for ${filePath}:`, err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// Create branch - Enhanced with better error handling
app.post('/api/azure/createBranch', async (req, res) => {
  const { organization, project, repositoryId, branchName, sourceBranch, token } = req.body;
  if (!organization || !project || !repositoryId || !branchName || !sourceBranch || !token) return res.status(400).json({ error: 'Missing params' });
  try {
    console.log(`Creating branch ${branchName} from ${sourceBranch} in repository ${repositoryId}`);
    
    // Get the source branch commit first
    const branchResponse = await axios.get(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/refs?filter=heads/${sourceBranch}&api-version=7.0`,
      { headers: { 'Authorization': getAzureAuthHeader(token), 'Accept': 'application/json' } }
    );
    
    if (!branchResponse.data || !branchResponse.data.value || branchResponse.data.value.length === 0) {
      console.error(`Source branch ${sourceBranch} not found`);
      return res.json({ success: false, error: 'Source branch not found' });
    }
    
    const sourceCommitId = branchResponse.data.value[0].objectId;
    console.log(`Source branch commit ID: ${sourceCommitId}`);
    
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
    
    console.log(`Successfully created branch: ${branchName}`);
    res.json({ success: true });
  } catch (err) {
    if (err.response && err.response.status === 409) {
      // Branch already exists
      console.log(`Branch ${branchName} already exists`);
      return res.json({ success: true });
    }
    console.error('Branch creation error:', err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

// Enhanced commit files with better validation and error handling
app.post('/api/azure/commitFiles', async (req, res) => {
  const { organization, project, repositoryId, branchName, files, message, token } = req.body;
  if (!organization || !project || !repositoryId || !branchName || !files || !message || !token) return res.status(400).json({ error: 'Missing params' });
  
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'Files array is empty or invalid' });
  }
  
  try {
    console.log(`Committing ${files.length} files to branch ${branchName} in repository ${repositoryId}`);
    console.log('Files to commit:', files.map(f => f.path));
    
    // Get the latest commit on the branch
    const branchResponse = await axios.get(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/refs?filter=heads/${branchName}&api-version=7.0`,
      { headers: { 'Authorization': getAzureAuthHeader(token), 'Accept': 'application/json' } }
    );
    
    if (!branchResponse.data || !branchResponse.data.value || branchResponse.data.value.length === 0) {
      console.error(`Branch ${branchName} not found`);
      return res.json({ success: false, error: 'Branch not found' });
    }
    
    const branchObjectId = branchResponse.data.value[0].objectId;
    console.log(`Branch ${branchName} commit ID: ${branchObjectId}`);
    
    // Validate files have required properties
    for (const file of files) {
      if (!file.path || !file.content) {
        console.error('Invalid file object:', file);
        return res.status(400).json({ error: 'All files must have path and content properties' });
      }
    }
    
    const changes = files.map(file => ({
      changeType: 'edit',
      item: { path: `/${file.path}` },
      newContent: { content: file.content, contentType: 'rawtext' }
    }));
    
    const pushPayload = {
      refUpdates: [{ name: `refs/heads/${branchName}`, oldObjectId: branchObjectId }],
      commits: [{ comment: message, changes }]
    };
    
    console.log('Push payload prepared with', changes.length, 'changes');
    
    const pushResponse = await axios.post(
      `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/pushes?api-version=7.0`,
      pushPayload,
      { 
        headers: { 
          'Authorization': getAzureAuthHeader(token), 
          'Content-Type': 'application/json',
          'Accept': 'application/json' 
        },
        timeout: 60000 // 60 second timeout for large commits
      }
    );
    
    console.log(`Successfully committed ${files.length} files to branch ${branchName}`);
    console.log('Push response:', pushResponse.data.pushedBy?.displayName || 'Unknown user');
    res.json({ success: true });
  } catch (err) {
    console.error('Commit files error:', err.response?.data || err.message);
    if (err.response?.data?.message) {
      console.error('Detailed error message:', err.response.data.message);
    }
    res.status(err.response?.status || 500).json({ 
      error: err.response?.data?.message || err.message,
      details: err.response?.data
    });
  }
});

// New endpoint: Check Maven dependency versions using Maven Central API
app.post('/api/maven/versions', async (req, res) => {
  const { dependencies } = req.body;
  
  if (!dependencies || !Array.isArray(dependencies)) {
    return res.status(400).json({ error: 'Dependencies array is required' });
  }
  
  try {
    console.log(`Checking versions for ${dependencies.length} dependencies...`);
    
    const versionChecks = dependencies.map(async (dep) => {
      const { groupId, artifactId, currentVersion } = dep;
      
      try {
        const response = await axios.get('https://search.maven.org/solrsearch/select', {
          params: {
            q: `g:"${groupId}" AND a:"${artifactId}"`,
            rows: 1,
            wt: 'json'
          },
          timeout: 10000
        });
        
        if (response.data?.response?.docs?.length > 0) {
          const latestVersion = response.data.response.docs[0].latestVersion;
          return {
            groupId,
            artifactId,
            currentVersion,
            latestVersion,
            hasUpdate: latestVersion !== currentVersion
          };
        } else {
          return {
            groupId,
            artifactId,
            currentVersion,
            latestVersion: currentVersion,
            hasUpdate: false
          };
        }
      } catch (error) {
        console.error(`Error checking version for ${groupId}:${artifactId}:`, error.message);
        return {
          groupId,
          artifactId,
          currentVersion,
          latestVersion: currentVersion,
          hasUpdate: false,
          error: error.message
        };
      }
    });
    
    const results = await Promise.all(versionChecks);
    console.log(`Version check completed. Found updates for ${results.filter(r => r.hasUpdate).length} dependencies.`);
    
    res.json({ versions: results });
  } catch (error) {
    console.error('Error in Maven version check:', error);
    res.status(500).json({ error: error.message });
  }
});

// New endpoint: Execute Maven commands (for future server-side Maven execution)
app.post('/api/maven/execute', async (req, res) => {
  const { pomContent, command = 'versions:display-dependency-updates' } = req.body;
  
  if (!pomContent) {
    return res.status(400).json({ error: 'POM content is required' });
  }
  
  try {
    console.log('Executing Maven command:', command);
    
    // Create temporary directory
    const tempDir = path.join(__dirname, 'temp', Date.now().toString());
    fs.mkdirSync(tempDir, { recursive: true });
    
    // Write POM file
    const pomPath = path.join(tempDir, 'pom.xml');
    fs.writeFileSync(pomPath, pomContent);
    
    // Execute Maven command
    const mvnCommand = `mvn ${command} -f "${pomPath}" -q`;
    
    exec(mvnCommand, { timeout: 30000 }, (error, stdout, stderr) => {
      // Cleanup
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn('Failed to cleanup temp directory:', cleanupError);
      }
      
      if (error) {
        console.error('Maven command failed:', error);
        return res.status(500).json({ 
          error: 'Maven command failed', 
          details: error.message,
          stderr 
        });
      }
      
      console.log('Maven command completed successfully');
      res.json({ 
        output: stdout,
        stderr: stderr || null
      });
    });
    
  } catch (error) {
    console.error('Error executing Maven command:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3031;
app.listen(PORT, () => console.log(`Azure DevOps proxy listening on port ${PORT}`));
