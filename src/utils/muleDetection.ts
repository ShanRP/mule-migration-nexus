
import { supabase } from '@/integrations/supabase/client';

interface MuleDependency {
  groupId: string;
  artifactId: string;
  version: string;
  latestVersion: string;
  isDeprecated: boolean;
  replacement?: string;
}

interface MuleConnector {
  name: string;
  namespace: string;
  isDeprecated: boolean;
  cloudHub2Alternative?: string;
}

export const isMuleApplication = (pomXml: string): boolean => {
  console.log('Checking if application is Mule...');
  
  // Enhanced Mule-specific indicators
  const muleIndicators = [
    // Basic Mule patterns
    /<groupId>org\.mule\./,
    /<artifactId>mule-/,
    /<mule\.version>/,
    /<packaging>mule-application<\/packaging>/,
    /<packaging>mule<\/packaging>/,
    
    // Plugin patterns
    /<plugin>[\s\S]*?<groupId>org\.mule\.tools\.maven<\/groupId>/,
    /<groupId>org\.mule\.tools\.maven<\/groupId>/,
    
    // Dependency patterns
    /<dependency>[\s\S]*?<groupId>org\.mule\.connectors<\/groupId>/,
    /<dependency>[\s\S]*?<groupId>org\.mule\.modules<\/groupId>/,
    /<dependency>[\s\S]*?<groupId>com\.mulesoft\.connectors<\/groupId>/,
    /<groupId>org\.mule\.connectors<\/groupId>/,
    /<groupId>org\.mule\.modules<\/groupId>/,
    /<groupId>com\.mulesoft\.connectors<\/groupId>/,
    
    // Mule runtime patterns
    /<artifactId>mule-core<\/artifactId>/,
    /<artifactId>mule-module-/,
    /<artifactId>mule-transport-/,
    
    // Additional patterns from your image
    /<modelVersion>4\.0\.0<\/modelVersion>[\s\S]*?<groupId>com\.mycompany<\/groupId>/,
    /<name>project1<\/name>/,
    /<app\.runtime>[\d\.]+<\/app\.runtime>/,
    /mule\.maven\.plugin/
  ];

  const isMatch = muleIndicators.some(regex => {
    const match = regex.test(pomXml);
    if (match) {
      console.log(`Matched pattern: ${regex}`);
    }
    return match;
  });
  
  console.log(`Is Mule application: ${isMatch}`);
  return isMatch;
};

export const extractMuleInfo = async (pomXml: string, artifactJson?: any) => {
  console.log('Extracting Mule information...');
  console.log('Artifact JSON received:', artifactJson);

  // Application name: get the first <name> tag that is a direct child of <project>
  let applicationName = 'Unknown';
  const nameMatch = pomXml.match(/<project[\s\S]*?<name>(.*?)<\/name>/);
  if (nameMatch && nameMatch[1]) {
    applicationName = nameMatch[1].trim();
  }

  // Mule runtime
  let muleRuntime = 'Unknown';
  const runtimeMatch = pomXml.match(/<app\.runtime>(.*?)<\/app\.runtime>/);
  if (runtimeMatch && runtimeMatch[1]) {
    muleRuntime = runtimeMatch[1];
  }

  // Mule version (plugin version)
  let muleVersion = 'Unknown';
  const muleVersionMatch = pomXml.match(/<mule\.maven\.plugin\.version>(.*?)<\/mule\.maven\.plugin\.version>/);
  if (muleVersionMatch && muleVersionMatch[1]) {
    muleVersion = muleVersionMatch[1];
  }

  // Enhanced Java version extraction with better handling
  let javaVersion = 'Unknown';
  if (artifactJson) {
    console.log('Processing artifact JSON for Java version:', artifactJson);
    
    try {
      // Handle both parsed object and string versions
      let jsonObj = artifactJson;
      if (typeof artifactJson === 'string') {
        try {
          jsonObj = JSON.parse(artifactJson);
        } catch (parseError) {
          console.error('Failed to parse artifact JSON:', parseError);
          jsonObj = {};
        }
      }
      
      console.log('Parsed JSON object:', jsonObj);
      
      // Check various possible keys for Java version with priority order
      const javaKeys = [
        'javaSpecificationVersions', // Most common in Mule
        'javaSpecificationVersion', 
        'javaVersions',
        'javaVersion',
        'java',
        'jvm',
        'jvmVersion'
      ];
      
      for (const key of javaKeys) {
        if (jsonObj[key] !== undefined && jsonObj[key] !== null) {
          console.log(`Found Java version under key '${key}':`, jsonObj[key]);
          
          if (Array.isArray(jsonObj[key]) && jsonObj[key].length > 0) {
            javaVersion = String(jsonObj[key][0]);
            console.log(`Extracted Java version from array: ${javaVersion}`);
            break;
          } else if (typeof jsonObj[key] === 'string' || typeof jsonObj[key] === 'number') {
            javaVersion = String(jsonObj[key]);
            console.log(`Extracted Java version directly: ${javaVersion}`);
            break;
          }
        }
      }
      
      // If still unknown, search case-insensitively through all keys
      if (javaVersion === 'Unknown') {
        console.log('Searching case-insensitively for Java version...');
        for (const [key, value] of Object.entries(jsonObj)) {
          const lowerKey = key.toLowerCase();
          if (lowerKey.includes('java') && value !== undefined && value !== null && value !== '') {
            console.log(`Found potential Java key: ${key} with value:`, value);
            if (Array.isArray(value) && value.length > 0) {
              javaVersion = String(value[0]);
              console.log(`Extracted Java version from case-insensitive search: ${javaVersion}`);
              break;
            } else if (typeof value === 'string' || typeof value === 'number') {
              javaVersion = String(value);
              console.log(`Extracted Java version from case-insensitive search: ${javaVersion}`);
              break;
            }
          }
        }
      }
      
    } catch (error) {
      console.error('Error processing artifact JSON for Java version:', error);
    }
  } else {
    console.log('No artifact JSON provided for Java version extraction');
  }
  
  // Fallback: try to extract Java version from POM
  if (javaVersion === 'Unknown') {
    console.log('Attempting to extract Java version from POM...');
    const javaVersionPatterns = [
      /<maven\.compiler\.source>(.*?)<\/maven\.compiler\.source>/,
      /<maven\.compiler\.target>(.*?)<\/maven\.compiler\.target>/,
      /<java\.version>(.*?)<\/java\.version>/,
      /<source>(.*?)<\/source>/,
      /<target>(.*?)<\/target>/
    ];
    
    for (const pattern of javaVersionPatterns) {
      const match = pomXml.match(pattern);
      if (match && match[1]) {
        javaVersion = match[1];
        console.log(`Extracted Java version from POM: ${javaVersion}`);
        break;
      }
    }
  }
  
  console.log(`Final extracted Java version: ${javaVersion}`);

  // Dependencies extraction with better error handling
  const depMatches = [...pomXml.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)];
  const dependencies = await Promise.all(
    depMatches
      .map(match => {
        const depXml = match[1];
        const groupId = (depXml.match(/<groupId>(.*?)<\/groupId>/) || [])[1] || '';
        const artifactId = (depXml.match(/<artifactId>(.*?)<\/artifactId>/) || [])[1] || '';
        const version = (depXml.match(/<version>(.*?)<\/version>/) || [])[1] || '';
        return { groupId, artifactId, version };
      })
      .filter(dep => 
        dep.groupId && dep.artifactId && (
          dep.groupId.includes('mule') || 
          dep.artifactId.includes('mule') ||
          dep.groupId.includes('org.mule') ||
          dep.groupId.includes('com.mulesoft')
        )
      )
      .map(async dep => {
        const isDeprecated = checkIfDeprecated(dep.groupId, dep.artifactId);
        const replacement = getReplacementDependency(dep.groupId, dep.artifactId);
        const latestVersion = await getLatestVersion(dep.groupId, dep.artifactId, dep.version);
        return {
          groupId: dep.groupId,
          artifactId: dep.artifactId,
          version: dep.version,
          latestVersion,
          isDeprecated,
          replacement
        };
      })
  );

  console.log('Final extraction results:', { applicationName, muleRuntime, muleVersion, javaVersion, dependencies: dependencies.length });
  return { applicationName, muleRuntime, muleVersion, javaVersion, dependencies };
};

export const analyzeMuleConfiguration = (muleConfigXml: string): MuleConnector[] => {
  const connectors: MuleConnector[] = [];
  
  console.log('Analyzing Mule configuration for connectors...');
  
  // Extract connectors from namespaces with better name extraction
  const namespaceMatches = [...muleConfigXml.matchAll(/xmlns:(\w+)="([^"]+)"/g)];
  namespaceMatches.forEach(match => {
    const prefix = match[1];
    const namespace = match[2];
    
    // Skip common non-connector namespaces
    const skipNamespaces = ['xsi', 'mule', 'doc', 'spring', 'core'];
    if (skipNamespaces.includes(prefix)) {
      return;
    }
    
    let isDeprecated = isDeprecatedConnector(namespace);
    let cloudHub2Alternative = getCloudHub2Alternative(namespace);
    
    // Extract a cleaner connector name from namespace
    let connectorName = prefix;
    if (namespace.includes('/mule/')) {
      const parts = namespace.split('/mule/');
      if (parts.length > 1) {
        connectorName = parts[1].replace(/\/$/, '') || prefix;
      }
    }
    
    if (namespace.includes('mule') || namespace.includes('connector') || namespace.includes('module')) {
      connectors.push({
        name: connectorName,
        namespace,
        isDeprecated,
        cloudHub2Alternative
      });
    }
  });
  
  // Look for specific connector usage patterns in flows with better detection
  const connectorUsagePatterns = [
    // VM connector
    { pattern: /<vm:/g, name: 'VM', deprecated: true, alternative: 'VM Connector 2.0 (CloudHub 2.0)' },
    // JMS connector
    { pattern: /<jms:/g, name: 'JMS', deprecated: true, alternative: 'JMS Connector 1.8+ (CloudHub 2.0)' },
    // File connector
    { pattern: /<file:/g, name: 'File', deprecated: true, alternative: 'File Connector 1.5+ (CloudHub 2.0)' },
    // FTP connector
    { pattern: /<ftp:/g, name: 'FTP', deprecated: true, alternative: 'FTP Connector 1.8+ (CloudHub 2.0)' },
    // SFTP connector
    { pattern: /<sftp:/g, name: 'SFTP', deprecated: true, alternative: 'SFTP Connector 2.4+ (CloudHub 2.0)' },
    // Email connector
    { pattern: /<email:/g, name: 'Email', deprecated: true, alternative: 'Email Connector 1.4+ (CloudHub 2.0)' },
    // Database connector
    { pattern: /<db:/g, name: 'Database', deprecated: false, alternative: undefined },
    // HTTP connector
    { pattern: /<http:/g, name: 'HTTP', deprecated: false, alternative: undefined },
    // TCP connector
    { pattern: /<tcp:/g, name: 'TCP', deprecated: true, alternative: 'Sockets Connector (CloudHub 2.0)' },
    // UDP connector
    { pattern: /<udp:/g, name: 'UDP', deprecated: true, alternative: 'Sockets Connector (CloudHub 2.0)' }
  ];

  connectorUsagePatterns.forEach(({ pattern, name, deprecated, alternative }) => {
    if (pattern.test(muleConfigXml)) {
      const existingConnector = connectors.find(c => 
        c.name.toLowerCase().includes(name.toLowerCase()) || 
        c.namespace.includes(name.toLowerCase())
      );
      
      if (!existingConnector) {
        connectors.push({
          name: name,
          namespace: `mule-${name.toLowerCase()}`,
          isDeprecated: deprecated,
          cloudHub2Alternative: alternative
        });
      }
    }
  });
  
  // Enhanced CloudHub connector detection
  const cloudHubPatterns = [
    /<cloudhub:create-notification/g,
    /<cloudhub:list-notifications/g,
    /<cloudhub:get-application/g,
    /<cloudhub:[^>]+>/g,
    /xmlns:cloudhub=/g
  ];
  
  let hasCloudHubConnector = false;
  cloudHubPatterns.forEach(pattern => {
    if (pattern.test(muleConfigXml)) {
      hasCloudHubConnector = true;
    }
  });
  
  // Only add CloudHub connector replacement if CloudHub connector is actually present
  if (hasCloudHubConnector) {
    console.log('CloudHub connector detected in configuration - adding replacement recommendation');
    const existingCloudHub = connectors.find(c => 
      c.name.toLowerCase().includes('cloudhub') || 
      c.namespace.includes('cloudhub')
    );
    if (!existingCloudHub) {
      connectors.push({
        name: 'CloudHub',
        namespace: 'cloudhub',
        isDeprecated: true,
        cloudHub2Alternative: 'Logger Connector (CloudHub 2.0 replacement)'
      });
    }
  }
  
  console.log(`Found ${connectors.length} connectors in configuration:`, connectors.map(c => c.name));
  return connectors;
};

const checkIfDeprecated = (groupId: string, artifactId: string): boolean => {
  const deprecatedDependencies = [
    'mule-transport-',
    'mule-module-xml',
    'mule-module-spring-config',
    'mule-module-client',
    'mule-module-cxf',
    'mule-module-ws',
    'mule-module-json',
    'mule-module-scripting'
  ];
  
  return deprecatedDependencies.some(dep => artifactId.includes(dep));
};

const getReplacementDependency = (groupId: string, artifactId: string): string | undefined => {
  const replacements: Record<string, string> = {
    'mule-transport-vm': 'VM Connector 2.0',
    'mule-transport-jms': 'JMS Connector 1.8',
    'mule-transport-file': 'File Connector 1.5',
    'mule-transport-ftp': 'FTP Connector 1.8',
    'mule-transport-sftp': 'SFTP Connector 1.5',
    'mule-transport-email': 'Email Connector 1.4',
    'mule-module-xml': 'XML Module 1.3',
    'mule-module-json': 'JSON Module 2.3'
  };
  
  return replacements[artifactId];
};

const getLatestVersionFromAPI = async (artifactId: string): Promise<string | null> => {
  try {
    console.log(`Fetching latest version for ${artifactId} from Supabase Edge Function...`);
    
    // Call the Edge Function with the artifactId as a URL parameter named 'name'
    const response = await fetch(`https://kmlxkpfwtcrlgkiuwyqs.supabase.co/functions/v1/mule-connector-versions?name=${encodeURIComponent(artifactId)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${supabase.supabaseKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      console.error(`Error calling Edge Function for ${artifactId}: ${response.status} ${response.statusText}`);
      return null;
    }
    
    const data = await response.json();
    
    if (data && data.version) {
      console.log(`Successfully fetched version ${data.version} for ${artifactId} from Edge Function`);
      return data.version;
    }
    
    console.log(`No version found in Edge Function response for ${artifactId}`);
    return null;
  } catch (error) {
    console.error(`Unexpected error calling Edge Function for ${artifactId}:`, error);
    return null;
  }
};

// Modify the getLatestVersion function to handle both sync and async cases
const getLatestVersion = async (groupId: string, artifactId: string, currentVersion: string): Promise<string> => {
  try {
    // Try to get the latest version from the Supabase Edge Function
    const latestVersionFromAPI = await getLatestVersionFromAPI(artifactId);
    if (latestVersionFromAPI) {
      return latestVersionFromAPI;
    }
  } catch (error) {
    console.error(`Error in getLatestVersion for ${artifactId}:`, error);
  }
  
  // Fallback to current version if API call fails
  console.log(`No version found for ${artifactId}, using current version ${currentVersion}`);
  return currentVersion;
};

const isDeprecatedConnector = (namespace: string): boolean => {
  const deprecatedNamespaces = [
    'http://www.mulesoft.org/schema/mule/vm',
    'http://www.mulesoft.org/schema/mule/jms',
    'http://www.mulesoft.org/schema/mule/file',
    'http://www.mulesoft.org/schema/mule/ftp',
    'http://www.mulesoft.org/schema/mule/email',
    'http://www.mulesoft.org/schema/mule/tcp',
    'http://www.mulesoft.org/schema/mule/udp',
    'http://www.mulesoft.org/schema/mule/cloudhub' // CloudHub namespace
  ];
  
  return deprecatedNamespaces.includes(namespace) || namespace.includes('cloudhub');
};

const getCloudHub2Alternative = (namespace: string): string | undefined => {
  const alternatives: Record<string, string> = {
    'http://www.mulesoft.org/schema/mule/vm': 'VM Connector 2.0 (CloudHub 2.0 compatible)',
    'http://www.mulesoft.org/schema/mule/jms': 'JMS Connector 1.8+ (CloudHub 2.0 compatible)',
    'http://www.mulesoft.org/schema/mule/file': 'File Connector 1.5+ (CloudHub 2.0 compatible)',
    'http://www.mulesoft.org/schema/mule/ftp': 'FTP Connector 1.8+ (CloudHub 2.0 compatible)',
    'http://www.mulesoft.org/schema/mule/email': 'Email Connector 1.4+ (CloudHub 2.0 compatible)',
    'http://www.mulesoft.org/schema/mule/cloudhub': 'Logger Connector (CloudHub 2.0 replacement)',
    'mule-vm': 'VM Connector 2.0',
    'mule-jms': 'JMS Connector 1.8+',
    'mule-file': 'File Connector 1.5+',
    'mule-ftp': 'FTP Connector 1.8+',
    'mule-email': 'Email Connector 1.4+',
    'mule-cloudhub': 'Logger Connector (CloudHub 2.0 replacement)'
  };
  
  // Handle CloudHub-related namespaces
  if (namespace.includes('cloudhub')) {
    return 'Logger Connector (CloudHub 2.0 replacement)';
  }
  
  return alternatives[namespace];
};

export const getLatestMuleVersion = () => '4.9.0';
export const getLatestJavaVersion = () => '17';

export const extractAzureOrganization = (url: string): string => {
  if (!url) return '';
  // Accepts both https://dev.azure.com/org and https://org.visualstudio.com
  const devAzureMatch = url.match(/dev\.azure\.com\/([^/]+)/);
  if (devAzureMatch) return devAzureMatch[1];
  const vsMatch = url.match(/https:\/\/([^\.]+)\.visualstudio\.com/);
  if (vsMatch) return vsMatch[1];
  return '';
};
