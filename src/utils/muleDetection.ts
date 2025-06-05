import { MavenVersionService } from './mavenVersionService';

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

// Keep static versions as fallback
const fallbackConnectorVersions: Record<string, string> = {
  'mule-marketo-connector': '3.0.9',
  'mule-oauth-module': '1.1.21',
  'mule-amazon-ec2-connector': '2.5.8',
  'mule-amazon-s3-connector': '7.0.5',
  'mule-amazon-sns-connector': '4.7.11',
  'mule-amazon-sqs-connector': '5.11.15',
  'mule-amqp-connector': '1.8.2',
  'anypoint-mq-connector': '4.0.12',
  'mule-cassandradb-connector': '4.1.3',
  'mule-kafka-connector': '4.10.1',
  'mule-azure-service-bus-connector': '3.4.1',
  'mule-box-connector': '5.3.0',
  'mule-file-connector': '1.5.3',
  'mule-db-connector': '1.14.14',
  'mule-cloudhub-connector': '1.2.0',
  'mule-http-connector': '1.10.3',
  'mule-ftp-connector': '2.0.0',
  'mule-email-connector': '1.7.5',
  'mule-microsoft-dotnet-connector': '3.1.8',
  'mule-jms-connector': '1.10.1',
  'mule-ldap-connector': '3.6.0',
  'mule-microsoft-dynamics-gp-connector': '2.1.7',
  'mule-microsoft-dynamics-crm-connector': '3.2.15',
  'mule-microsoft-service-bus-connector': '2.2.7',
  'mule-objectstore-connector': '1.2.2',
  'mule-module-file-extension-common': '1.4.3',
  'mule-powershell-connector': '2.1.3',
  'mule-mongodb-connector': '6.3.10',
  'mule-hdfs-connector': '6.0.26',
  'mule-sharepoint-connector': '3.7.0',
  'mule-neo4j-connector': '3.0.7',
  'mule-peoplesoft-connector': '3.1.9',
  'mule-oracle-ebs-122-connector': '2.3.1',
  'mule-netsuite-openair-connector': '2.0.12',
  'mule-netsuite-connector': '11.10.0',
  'mule-redis-connector': '5.4.6',
  'mule-salesforce-composite-connector': '2.18.1',
  'mule-salesforce-connector': '11.1.0',
  'mule-rosettanet-connector': '2.1.0',
  'mule-sfdc-analytics-connector': '3.17.0',
  'mule-sfdc-marketing-cloud-connector': '4.1.4',
  'mule-sap-concur-connector': '4.2.3',
  'mule-sftp-connector': '2.4.4',
  'mule-sap-connector': '5.9.12',
  'mule-servicenow-connector': '6.17.1',
  'mule-wsc-connector': '1.11.1',
  'mule-workday-connector': '16.3.0',
  'mule-zuora-connector': '6.0.11',
  'mule-twilio-connector': '4.2.9',
  'mule-sockets-connector': '1.2.5',
  'mule-xml-module': '1.4.2',
};

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

  // Dependencies extraction with better error handling and dynamic version fetching
  const depMatches = [...pomXml.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)];
  const extractedDeps = depMatches
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
    );

  // Fetch latest versions dynamically
  console.log('Fetching latest versions for dependencies...');
  let dependencies: MuleDependency[] = [];
  
  try {
    const mavenDeps = extractedDeps.map(dep => ({
      groupId: dep.groupId,
      artifactId: dep.artifactId,
      currentVersion: dep.version
    }));

    const versionUpdates = await MavenVersionService.getLatestVersionsBatch(mavenDeps);
    
    dependencies = versionUpdates.map(update => {
      const isDeprecated = checkIfDeprecated(update.groupId, update.artifactId);
      const replacement = getReplacementDependency(update.groupId, update.artifactId);
      
      return {
        groupId: update.groupId,
        artifactId: update.artifactId,
        version: update.currentVersion,
        latestVersion: update.latestVersion,
        isDeprecated,
        replacement
      };
    });
    
    console.log(`Successfully fetched latest versions for ${dependencies.length} dependencies`);
  } catch (error) {
    console.error('Error fetching latest versions, using fallback:', error);
    
    // Fallback to static versions if dynamic fetching fails
    dependencies = extractedDeps.map(dep => {
      const isDeprecated = checkIfDeprecated(dep.groupId, dep.artifactId);
      const replacement = getReplacementDependency(dep.groupId, dep.artifactId);
      const latestVersion = getLatestVersionFallback(dep.groupId, dep.artifactId, dep.version);
      
      return {
        groupId: dep.groupId,
        artifactId: dep.artifactId,
        version: dep.version,
        latestVersion,
        isDeprecated,
        replacement
      };
    });
  }

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

const getLatestVersionFallback = (groupId: string, artifactId: string, currentVersion: string): string => {
  return fallbackConnectorVersions[artifactId] || currentVersion;
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

// Export the MavenVersionService for use in other components
export { MavenVersionService };
