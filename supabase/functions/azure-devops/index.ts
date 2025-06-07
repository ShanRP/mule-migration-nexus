import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from '../_shared/cors.ts'

interface MigrationRules {
  javaVersion: string;
  muleVersion: string;
  minMuleVersion: string;
  connectorReplacements: { from: string; to: string; }[];
  dependencyVersions: { artifactId: string; version: string; }[];
}

// Default migration rules (fallback)
const DEFAULT_RULES: MigrationRules = {
  javaVersion: "17",
  muleVersion: "4.9.0",
  minMuleVersion: "4.9.0",
  connectorReplacements: [
    { from: 'cloudhub', to: 'logger' }
  ],
  dependencyVersions: []
};

// Apply migration rules with highest priority
function applyMigrationRules(rules: MigrationRules): MigrationRules {
  console.log('=== APPLYING MIGRATION RULES WITH HIGHEST PRIORITY ===');
  console.log('Input rules:', rules);
  
  // Rules take ABSOLUTE PRIORITY over defaults
  const appliedRules = {
    javaVersion: rules.javaVersion || DEFAULT_RULES.javaVersion,
    muleVersion: rules.muleVersion || DEFAULT_RULES.muleVersion,
    minMuleVersion: rules.minMuleVersion || DEFAULT_RULES.minMuleVersion,
    connectorReplacements: rules.connectorReplacements.length > 0 ? rules.connectorReplacements : DEFAULT_RULES.connectorReplacements,
    dependencyVersions: rules.dependencyVersions || []
  };
  
  console.log('Applied rules (HIGHEST PRIORITY):', appliedRules);
  return appliedRules;
}

// Get rule-based dependency version
function getRuleBasedDependencyVersion(artifactId: string, defaultVersion: string, rules: MigrationRules): string {
  console.log(`Checking dependency version for ${artifactId} - Rules first, then defaults`);
  
  // FIRST PRIORITY: Check migration rules for custom dependency version
  const customRule = rules.dependencyVersions.find(dep => dep.artifactId === artifactId);
  if (customRule && customRule.version) {
    console.log(`RULES PRIORITY: Using custom version ${customRule.version} for ${artifactId} (from migration rules)`);
    return customRule.version;
  }
  
  console.log(`No custom rule found for ${artifactId}, using default version: ${defaultVersion}`);
  return defaultVersion;
}

// Get rule-based connector replacement
function getRuleBasedConnectorReplacement(connectorName: string, rules: MigrationRules): string {
  console.log(`Checking connector replacement for ${connectorName} - Rules first, then defaults`);
  
  // FIRST PRIORITY: Check migration rules for custom connector replacement
  const customReplacement = rules.connectorReplacements.find(rep => 
    connectorName.toLowerCase().includes(rep.from.toLowerCase())
  );
  
  if (customReplacement && customReplacement.to) {
    console.log(`RULES PRIORITY: Using custom replacement ${customReplacement.to} for ${connectorName} (from migration rules)`);
    return customReplacement.to;
  }
  
  console.log(`No custom rule found for ${connectorName}, using default replacement: logger`);
  return 'logger';
}

// Update POM dependencies with RULES PRIORITY
function updatePomDependencies(pomXml: string, dependencies: any[], selections: any, rules: MigrationRules): string {
  let updatedPom = pomXml;
  
  console.log('=== POM UPDATE: Migration Rules take HIGHEST PRIORITY ===');
  console.log('Using migration rules:', rules);
  
  // Update app.runtime version if selected - RULES FIRST
  if (selections.muleRuntime) {
    console.log(`Updating app.runtime to: ${rules.muleVersion} (prioritizing rules)`);
    updatedPom = updatedPom.replace(
      /<app\.runtime>.*?<\/app\.runtime>/g,
      `<app.runtime>${rules.muleVersion}</app.runtime>`
    );
  }
  
  // Remove CloudHub dependencies
  const cloudHubDepPatterns = [
    /<dependency>\s*<groupId>org\.mule\.modules<\/groupId>\s*<artifactId>mule-module-cloudhub<\/artifactId>[\s\S]*?<\/dependency>/g,
    /<dependency>\s*<groupId>org\.mule\.connectors<\/groupId>\s*<artifactId>mule-cloudhub-connector<\/artifactId>[\s\S]*?<\/dependency>/g,
    /<dependency>[\s\S]*?<artifactId>[^<]*cloudhub[^<]*<\/artifactId>[\s\S]*?<\/dependency>/g,
    /<dependency>\s*<groupId>com\.mulesoft\.cloudhub<\/groupId>[\s\S]*?<\/dependency>/g,
    /<dependency>\s*<groupId>com\.mulesoft\.modules\.cloudhub<\/groupId>[\s\S]*?<\/dependency>/g
  ];
  
  cloudHubDepPatterns.forEach(pattern => {
    const matches = updatedPom.match(pattern);
    if (matches) {
      updatedPom = updatedPom.replace(pattern, '');
    }
  });
  
  // Update selected dependencies - RULES TAKE PRIORITY OVER EVERYTHING
  dependencies.forEach(dep => {
    if (selections.dependencies.includes(dep.artifactId)) {
      // PRIORITY 1: Check migration rules first
      const ruleBasedVersion = getRuleBasedDependencyVersion(dep.artifactId, dep.latestVersion, rules);
      
      if (ruleBasedVersion && ruleBasedVersion !== dep.version) {
        console.log(`PRIORITY UPDATE: ${dep.artifactId} from ${dep.version} to ${ruleBasedVersion}`);
        
        const dependencyRegex = new RegExp(
          `(<dependency>[\\s\\S]*?<groupId>${dep.groupId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/groupId>[\\s\\S]*?<artifactId>${dep.artifactId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/artifactId>[\\s\\S]*?<version>).*?(<\\/version>[\\s\\S]*?<\\/dependency>)`,
          'g'
        );
        
        updatedPom = updatedPom.replace(dependencyRegex, `$1${ruleBasedVersion}$2`);
      }
    }
  });
  
  // Clean up and add migration comment
  updatedPom = updatedPom.replace(/\n\s*\n\s*\n/g, '\n\n');
  
  if (!updatedPom.includes('<!-- Updated for CloudHub 2.0 migration with rules priority -->')) {
    updatedPom = updatedPom + '\n<!-- Updated for CloudHub 2.0 migration with rules priority -->';
  }
  
  return updatedPom;
}

// Replace connectors with RULES PRIORITY
function replaceCloudHubConnectors(xmlContent: string, selections: any, rules: MigrationRules): string {
  let updatedXml = xmlContent;
  
  console.log('=== CONNECTOR REPLACEMENT: Migration Rules take HIGHEST PRIORITY ===');
  console.log('Using migration rules:', rules);
  
  // Only process selected connectors
  const selectedCloudHubConnectors = selections.connectors.filter((name: string) => 
    name.toLowerCase().includes('cloudhub')
  );
  
  if (selectedCloudHubConnectors.length === 0) {
    return xmlContent;
  }
  
  // PRIORITY 1: Get replacement connector from migration rules
  const ruleBasedReplacement = getRuleBasedConnectorReplacement('cloudhub', rules);
  console.log(`Using connector replacement: ${ruleBasedReplacement} (from migration rules priority)`);
  
  // Add replacement namespace if not present
  if (ruleBasedReplacement === 'logger' && !updatedXml.includes('xmlns:logger=')) {
    const muleTag = updatedXml.match(/<mule[^>]*>/);
    if (muleTag) {
      const updatedMuleTag = muleTag[0].replace('>', ` xmlns:logger="http://www.mulesoft.org/schema/mule/logger" xsi:schemaLocation="http://www.mulesoft.org/schema/mule/logger http://www.mulesoft.org/schema/mule/logger/current/mule-logger.xsd">`);
      updatedXml = updatedXml.replace(muleTag[0], updatedMuleTag);
    }
  }
  
  // Replace CloudHub connectors with rule-based replacement
  const cloudHubPatterns = [
    {
      pattern: /<cloudhub:create-notification[^>]*>[\s\S]*?<\/cloudhub:create-notification>/g,
      replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub notification replaced with ${ruleBasedReplacement} for CloudHub 2.0 migration (rules priority)" />`
    },
    {
      pattern: /<cloudhub:create-notification[^>]*\/>/g,
      replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub notification replaced with ${ruleBasedReplacement} for CloudHub 2.0 migration (rules priority)" />`
    },
    {
      pattern: /<cloudhub:list-notifications[^>]*>[\s\S]*?<\/cloudhub:list-notifications>/g,
      replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub list notifications replaced with ${ruleBasedReplacement} for CloudHub 2.0 migration (rules priority)" />`
    },
    {
      pattern: /<cloudhub:list-notifications[^>]*\/>/g,
      replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub list notifications replaced with ${ruleBasedReplacement} for CloudHub 2.0 migration (rules priority)" />`
    },
    {
      pattern: /<cloudhub:get-application[^>]*>[\s\S]*?<\/cloudhub:get-application>/g,
      replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub get application replaced with ${ruleBasedReplacement} for CloudHub 2.0 migration (rules priority)" />`
    },
    {
      pattern: /<cloudhub:get-application[^>]*\/>/g,
      replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub get application replaced with ${ruleBasedReplacement} for CloudHub 2.0 migration (rules priority)" />`
    },
    {
      pattern: /<cloudhub:[^>]*>[\s\S]*?<\/cloudhub:[^>]*>/g,
      replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub operation replaced with ${ruleBasedReplacement} for CloudHub 2.0 migration (rules priority)" />`
    },
    {
      pattern: /<cloudhub:[^>]*\/>/g,
      replacement: `<${ruleBasedReplacement}:log level="INFO" message="CloudHub operation replaced with ${ruleBasedReplacement} for CloudHub 2.0 migration (rules priority)" />`
    }
  ];
  
  cloudHubPatterns.forEach(({ pattern, replacement }) => {
    const matches = updatedXml.match(pattern);
    if (matches) {
      console.log(`RULES PRIORITY: Replacing CloudHub connectors with ${ruleBasedReplacement}:`, matches);
      updatedXml = updatedXml.replace(pattern, replacement);
    }
  });
  
  // Remove CloudHub namespace if no more CloudHub elements exist
  if (!/<cloudhub:/.test(updatedXml)) {
    updatedXml = updatedXml.replace(/xmlns:cloudhub="[^"]*"\s*/g, '');
    updatedXml = updatedXml.replace(/http:\/\/www\.mulesoft\.org\/schema\/mule\/cloudhub[^\s]*/g, '');
  }
  
  return updatedXml;
}

const azureDevopsApi = (organization: string, token: string) => {
  const headers = {
    'Authorization': `Basic ${btoa(`:${token}`)}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  const getFileContent = async (project: string, repositoryId: string, filePath: string): Promise<string | null> => {
    try {
      const url = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/items?path=${encodeURIComponent(filePath)}&api-version=7.1&download=true`;
      const response = await fetch(url, { headers });

      if (!response.ok) {
        console.error(`Failed to fetch file content for ${filePath}: ${response.status} ${response.statusText}`);
        return null;
      }

      return await response.text();
    } catch (error) {
      console.error(`Error fetching file content for ${filePath}:`, error);
      return null;
    }
  };

  const createBranch = async (project: string, repositoryId: string, newBranchName: string, baseBranchName: string): Promise<boolean> => {
    try {
      // Get the commit ID of the base branch
      const baseBranchRefUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/refs?filter=heads/${baseBranchName}&api-version=7.1`;
      const baseBranchRefResponse = await fetch(baseBranchRefUrl, { headers });
      const baseBranchRefData = await baseBranchRefResponse.json();

      if (!baseBranchRefResponse.ok || baseBranchRefData.value.length === 0) {
        console.error(`Failed to get base branch ref for ${baseBranchName}: ${baseBranchRefResponse.status} ${baseBranchRefResponse.statusText}`);
        return false;
      }

      const baseCommitId = baseBranchRefData.value[0].objectId;

      // Create the new branch
      const newBranchRefUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/refs?api-version=7.1`;
      const newBranchRefPayload = JSON.stringify([
        {
          name: `refs/heads/${newBranchName}`,
          oldObjectId: '0000000000000000000000000000000000000000', // Indicates a new branch
          newObjectId: baseCommitId
        }
      ]);

      const newBranchRefResponse = await fetch(newBranchRefUrl, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: newBranchRefPayload
      });

      if (!newBranchRefResponse.ok) {
        console.error(`Failed to create branch ${newBranchName}: ${newBranchRefResponse.status} ${newBranchRefResponse.statusText}`);
        try {
          const errorData = await newBranchRefResponse.json();
          console.error('Error details:', errorData);
        } catch (e) {
          console.error('Failed to parse error response:', e);
        }
        return false;
      }

      console.log(`Branch ${newBranchName} created successfully`);
      return true;
    } catch (error) {
      console.error(`Error creating branch ${newBranchName}:`, error);
      return false;
    }
  };

  const commitFiles = async (project: string, repositoryId: string, branchName: string, files: any[], commitMessage: string): Promise<boolean> => {
    try {
      // Get the current commit ID of the branch
      const branchUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/refs?filter=heads/${branchName}&api-version=7.1`;
      const branchResponse = await fetch(branchUrl, { headers });
      const branchData = await branchResponse.json();

      if (!branchResponse.ok || branchData.value.length === 0) {
        console.error(`Failed to get branch ref for ${branchName}: ${branchResponse.status} ${branchResponse.statusText}`);
        return false;
      }

      const currentCommitId = branchData.value[0].objectId;

      // Prepare the commit changes
      const changes = files.map((file: any) => ({
        changeType: 'edit',
        item: {
          path: `/${file.path}`
        },
        newContent: {
          content: btoa(file.content),
          contentType: 'base64encoded'
        }
      }));

      // Create the commit
      const commitPayload = {
        refUpdates: [
          {
            name: `refs/heads/${branchName}`,
            oldObjectId: currentCommitId,
            newObjectId: null  // Let Azure DevOps calculate the new commit ID
          }
        ],
        commits: [
          {
            comment: commitMessage,
            changes: changes
          }
        ]
      };

      const commitUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/pushes?api-version=7.1`;
      const commitResponse = await fetch(commitUrl, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(commitPayload)
      });

      if (!commitResponse.ok) {
        console.error(`Failed to commit files to branch ${branchName}: ${commitResponse.status} ${commitResponse.statusText}`);
        try {
          const errorData = await commitResponse.json();
          console.error('Error details:', errorData);
        } catch (e) {
          console.error('Failed to parse error response:', e);
        }
        return false;
      }

      console.log(`Files committed successfully to branch ${branchName}`);
      return true;
    } catch (error) {
      console.error(`Error committing files to branch ${branchName}:`, error);
      return false;
    }
  };

  return { getFileContent, createBranch, commitFiles };
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { operation, organization, requestData } = await req.json();
    console.log(`Azure DevOps API request: ${operation}`, { organization, requestData });

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!Deno.env.get('AZURE_DEVOPS_TOKEN')) {
      console.error('Missing AZURE_DEVOPS_TOKEN environment variable');
      return new Response(JSON.stringify({ error: 'Missing AZURE_DEVOPS_TOKEN environment variable' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const headers = {
      'Authorization': `Basic ${btoa(`:${Deno.env.get('AZURE_DEVOPS_TOKEN')}`)}`,
      'Content-Type': 'application/json',
    };

    if (operation === 'getFileContent') {
      const { project, repositoryId, filePath } = requestData;
      const api = azureDevopsApi(organization, Deno.env.get('AZURE_DEVOPS_TOKEN') || '');
      const content = await api.getFileContent(project, repositoryId, filePath);

      if (content === null) {
        return new Response(JSON.stringify({ error: 'Failed to retrieve file content' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true, data: content }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (operation === 'createBranch') {
      const { project, repositoryId, newBranchName, baseBranchName } = requestData;
      const api = azureDevopsApi(organization, Deno.env.get('AZURE_DEVOPS_TOKEN') || '');
      const success = await api.createBranch(project, repositoryId, newBranchName, baseBranchName);

      if (!success) {
        return new Response(JSON.stringify({ error: 'Failed to create branch' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (operation === 'commitFiles') {
      const { project, repositoryId, branchName, files, message, migrationRules } = requestData;
      
      console.log('Committing files with migration rules:', migrationRules);
      
      // Apply migration rules with highest priority
      const appliedRules = applyMigrationRules(migrationRules || DEFAULT_RULES);
      
      // Process files with migration rules
      const processedFiles = files.map((file: any) => {
        if (file.path.endsWith('pom.xml') && file.selections) {
          const updatedContent = updatePomDependencies(file.content, file.dependencies || [], file.selections, appliedRules);
          return { ...file, content: updatedContent };
        } else if (file.path.endsWith('.xml') && file.selections && file.selections.connectors.length > 0) {
          const updatedContent = replaceCloudHubConnectors(file.content, file.selections, appliedRules);
          return { ...file, content: updatedContent };
        } else if (file.path.endsWith('mule-artifact.json') && file.selections) {
          let artifactJson = {};
          try {
            artifactJson = JSON.parse(file.content);
          } catch (e) {
            console.warn('Invalid JSON in artifact file, creating new:', e);
          }
          
          const updatedArtifact = { ...artifactJson };
          
          if (file.selections.javaVersion) {
            console.log(`RULES PRIORITY: Setting Java version to ${appliedRules.javaVersion}`);
            updatedArtifact.javaSpecificationVersions = [appliedRules.javaVersion];
          }
          
          if (file.selections.minMuleVersion) {
            console.log(`RULES PRIORITY: Setting min Mule version to ${appliedRules.minMuleVersion}`);
            updatedArtifact.minMuleVersion = appliedRules.minMuleVersion;
          }
          
          return { ...file, content: JSON.stringify(updatedArtifact, null, 2) };
        }
        return file;
      });

      const api = azureDevopsApi(organization, Deno.env.get('AZURE_DEVOPS_TOKEN') || '');
      
      console.log(`Committing ${processedFiles.length} files to branch ${branchName} in repository ${repositoryId}`);
      console.log('Files to commit:', processedFiles.map((f: any) => f.path));

      // Get current branch commit ID for the push
      const branchUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/refs?filter=heads/${branchName}&api-version=7.0`;
      const branchResponse = await fetch(branchUrl, { headers });
      const branchData = await branchResponse.json();
      const currentCommitId = branchData.value[0]?.objectId;

      console.log('Current branch commit ID:', currentCommitId);

      // Prepare commit payload
      const commitPayload = {
        refUpdates: [
          {
            name: `refs/heads/${branchName}`,
            oldObjectId: currentCommitId
          }
        ],
        commits: [
          {
            comment: message,
            changes: processedFiles.map((file: any) => ({
              changeType: 'edit',
              item: {
                path: `/${file.path}`
              },
              newContent: {
                content: btoa(file.content),
                contentType: 'base64encoded'
              }
            }))
          }
        ]
      };

      console.log('Commit payload structure:', JSON.stringify(commitPayload, null, 2));

      const commitUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repositoryId}/pushes?api-version=7.0`;
      const commitResponse = await fetch(commitUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(commitPayload)
      });

      const commitResult = await commitResponse.json();
      console.log('Commit response:', commitResult);

      if (commitResponse.ok) {
        console.log('Files committed successfully');
        return new Response(JSON.stringify({ success: true, data: commitResult }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } else {
        console.error('Failed to commit files:', commitResult);
        throw new Error(`Failed to commit files: ${commitResult.message || 'Unknown error'}`);
      }
    }

    return new Response(JSON.stringify({ error: 'Invalid operation' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Azure DevOps API error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
