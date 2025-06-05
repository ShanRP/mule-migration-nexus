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

import MuleSoftExchangeService from '../services/mulesoftExchangeApi';

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
  let applicationName = 'Unknown Application';
  const nameMatch = pomXml.match(/<project[\s\S]*?<name>(.*?)<\/name>/);
  if (nameMatch && nameMatch[1]) {
    applicationName = nameMatch[1].trim();
  } else {
    // Fallback: try to get name from artifactId
    const artifactIdMatch = pomXml.match(/<artifactId>(.*?)<\/artifactId>/);
    if (artifactIdMatch && artifactIdMatch[1]) {
      applicationName = artifactIdMatch[1].trim();
    }
  }

  // Ensure applicationName is never undefined or empty
  if (!applicationName || applicationName.trim() === '') {
    applicationName = 'Unnamed Mule Application';
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

  // Enhanced Java version extraction from artifactJson
  let javaVersion = 'Unknown';
  if (artifactJson) {
    console.log('Processing artifact JSON for Java version:', artifactJson);
    
    try {
      // Handle both parsed object and string versions
      let jsonObj = artifactJson;
      if (typeof artifactJson === 'string') {
        jsonObj = JSON.parse(artifactJson);
      }
      
      console.log('Parsed JSON object:', jsonObj);
      
      // Check various possible keys for Java version
      const javaKeys = [
        'javaSpecificationVersions',
        'javaSpecificationVersion', 
        'javaversion',
        'javaVersion',
        'java',
        'javaSpecification',
        'jvm',
        'jvmVersion'
      ];
      
      for (const key of javaKeys) {
        if (jsonObj[key]) {
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
          if (key.toLowerCase().includes('java')) {
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
      console.error('Error parsing artifact JSON:', error);
    }
  } else {
    console.log('No artifact JSON provided for Java version extraction');
  }
  
  console.log(`Final extracted Java version: ${javaVersion}`);

  // Dependencies - extract first, then get latest versions with fallback
  const depMatches = [...pomXml.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)];
  const basicDependencies = depMatches
    .map(match => {
      const depXml = match[1];
      const groupId = (depXml.match(/<groupId>(.*?)<\/groupId>/) || [])[1] || '';
      const artifactId = (depXml.match(/<artifactId>(.*?)<\/artifactId>/) || [])[1] || '';
      const version = (depXml.match(/<version>(.*?)<\/version>/) || [])[1] || '';
      return { groupId, artifactId, version };
    })
    .filter(dep => 
      dep.groupId.includes('mule') || 
      dep.artifactId.includes('mule') ||
      dep.groupId.includes('org.mule') ||
      dep.groupId.includes('com.mulesoft')
    );

  // Get latest versions with fallback - don't let Exchange API failures break the process
  let dependencies;
  try {
    dependencies = await getLatestVersionsForDependencies(basicDependencies);
  } catch (error) {
    console.error('Failed to get latest versions, using fallback:', error);
    // Fallback: create dependencies with current versions as latest
    dependencies = basicDependencies.map(dep => ({
      groupId: dep.groupId,
      artifactId: dep.artifactId,
      version: dep.version,
      latestVersion: dep.version, // Use current as latest when API fails
      isDeprecated: checkIfDeprecated(dep.groupId, dep.artifactId),
      replacement: getReplacementDependency(dep.groupId, dep.artifactId)
    }));
  }

  console.log('Final extraction results:', { applicationName, muleRuntime, muleVersion, javaVersion, dependencies: dependencies.length });
  return { applicationName, muleRuntime, muleVersion, javaVersion, dependencies };
};

export const analyzeMuleConfiguration = (muleConfigXml: string): MuleConnector[] => {
  const connectors: MuleConnector[] = [];
  
  console.log('Analyzing Mule configuration for connectors...');
  
  // Extract connectors from namespaces and flows
  const namespaceMatches = [...muleConfigXml.matchAll(/xmlns:(\w+)="([^"]+)"/g)];
  namespaceMatches.forEach(match => {
    const prefix = match[1];
    const namespace = match[2];
    let isDeprecated = isDeprecatedConnector(namespace);
    let cloudHub2Alternative = getCloudHub2Alternative(namespace);
    
    if (namespace.includes('mule') || namespace.includes('connector')) {
      connectors.push({
        name: prefix,
        namespace,
        isDeprecated,
        cloudHub2Alternative
      });
    }
  });
  
  // Look for VM connector with persistence
  if (/persistent\s*=\s*['"]?true['"]?/i.test(muleConfigXml) && /<vm:/i.test(muleConfigXml)) {
    connectors.push({
      name: 'Persistent VM Queue',
      namespace: 'vm',
      isDeprecated: true,
      cloudHub2Alternative: 'Replace with Logger connector (CloudHub 2.0)'
    });
  }
  
  // Enhanced CloudHub connector detection - ONLY if CloudHub connector is present
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
    const existingCloudHub = connectors.find(c => c.name === 'cloudhub' || c.namespace.includes('cloudhub'));
    if (!existingCloudHub) {
      connectors.push({
        name: 'CloudHub Connector',
        namespace: 'cloudhub',
        isDeprecated: true,
        cloudHub2Alternative: 'Logger Connector (CloudHub 2.0 replacement)'
      });
    }
  } else {
    console.log('No CloudHub connector found in configuration - skipping replacement recommendation');
  }
  
  // Also look for specific connector usage in flows
  const flowMatches = [...muleConfigXml.matchAll(/<flow[\s\S]*?<\/flow>/g)];
  flowMatches.forEach(flowMatch => {
    const flowXml = flowMatch[0];
    const deprecatedPatterns = [
      /<vm:/g,
      /<jms:/g,
      /<file:/g,
      /<ftp:/g,
      /<sftp:/g,
      /<email:/g,
      /<db:/g,
      /<http:/g,
      /<tcp:/g,
      /<udp:/g
    ];
    deprecatedPatterns.forEach(pattern => {
      if (pattern.test(flowXml)) {
        const connectorName = pattern.source.replace(/<|>/g, '').replace(':', '');
        if (!connectors.find(c => c.name === connectorName)) {
          connectors.push({
            name: connectorName,
            namespace: `mule-${connectorName}`,
            isDeprecated: true,
            cloudHub2Alternative: getCloudHub2Alternative(`mule-${connectorName}`)
          });
        }
      }
    });
  });
  
  console.log(`Found ${connectors.length} connectors in configuration`);
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

// Updated function to disable MuleSoft Exchange API due to CORS issues
const getLatestVersion = async (groupId: string, artifactId: string, currentVersion: string): Promise<string> => {
  // Disable MuleSoft Exchange API due to CORS restrictions in browser
  console.log(`Using fallback version for ${artifactId} due to CORS restrictions`);
  return latestConnectorVersions[artifactId] || currentVersion;
};

// Enhanced function to get latest versions for all dependencies with fallback
export const getLatestVersionsForDependencies = async (dependencies: Array<{groupId: string, artifactId: string, version: string}>) => {
  console.log('Getting latest versions for dependencies (using fallback due to CORS)...');
  
  // Use fallback versions instead of Exchange API to avoid CORS issues
  return dependencies.map(dep => {
    const latestVersion = latestConnectorVersions[dep.artifactId] || dep.version;
    const isDeprecated = checkIfDeprecated(dep.groupId, dep.artifactId);
    const replacement = getReplacementDependency(dep.groupId, dep.artifactId);
    
    return {
      groupId: dep.groupId,
      artifactId: dep.artifactId,
      version: dep.version,
      latestVersion,
      isDeprecated,
      replacement
    };
  });
};

const latestConnectorVersions: Record<string, string> = {
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
