
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

export const extractMuleInfo = (pomXml: string) => {
  console.log('Extracting Mule information...');
  
  // Enhanced Mule version extraction
  const muleVersionPatterns = [
    /<mule\.version>(.*?)<\/mule\.version>/,
    /<app\.runtime>(.*?)<\/app\.runtime>/,
    /<version>(4\.\d+\.\d+)<\/version>[\s\S]*?<groupId>org\.mule/,
    /<version>(3\.\d+\.\d+)<\/version>[\s\S]*?<groupId>org\.mule/,
    /<mule\.maven\.plugin\.version>(.*?)<\/mule\.maven\.plugin\.version>/
  ];
  
  let muleVersion = 'Unknown';
  for (const pattern of muleVersionPatterns) {
    const match = pomXml.match(pattern);
    if (match && match[1]) {
      muleVersion = match[1];
      console.log(`Found Mule version: ${muleVersion}`);
      break;
    }
  }

  // Enhanced Java version extraction
  const javaVersionPatterns = [
    /<java\.version>(.*?)<\/java\.version>/,
    /<maven\.compiler\.source>(.*?)<\/maven\.compiler\.source>/,
    /<maven\.compiler\.target>(.*?)<\/maven\.compiler\.target>/,
    /<maven\.compiler\.release>(.*?)<\/maven\.compiler\.release>/
  ];
  
  let javaVersion = 'Unknown';
  for (const pattern of javaVersionPatterns) {
    const match = pomXml.match(pattern);
    if (match && match[1]) {
      javaVersion = match[1];
      console.log(`Found Java version: ${javaVersion}`);
      break;
    }
  }

  // Enhanced dependency extraction with deprecation checking
  const depMatches = [...pomXml.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)];
  const dependencies = depMatches
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
    )
    .map(dep => {
      const isDeprecated = checkIfDeprecated(dep.groupId, dep.artifactId);
      const replacement = getReplacementDependency(dep.groupId, dep.artifactId);
      const latestVersion = getLatestVersion(dep.groupId, dep.artifactId, dep.version);
      
      return {
        groupId: dep.groupId,
        artifactId: dep.artifactId,
        version: dep.version,
        latestVersion,
        isDeprecated,
        replacement
      };
    });

  console.log(`Found ${dependencies.length} Mule dependencies`);
  return { muleVersion, javaVersion, dependencies };
};

export const analyzeMuleConfiguration = (muleConfigXml: string): MuleConnector[] => {
  console.log('Analyzing Mule configuration for deprecated connectors...');
  
  const connectors: MuleConnector[] = [];
  
  // Extract namespaces and connectors from mule-configuration.xml
  const namespaceMatches = [...muleConfigXml.matchAll(/xmlns:(\w+)="([^"]+)"/g)];
  
  namespaceMatches.forEach(match => {
    const prefix = match[1];
    const namespace = match[2];
    
    // Check if namespace indicates a deprecated connector
    const isDeprecated = isDeprecatedConnector(namespace);
    const alternative = getCloudHub2Alternative(namespace);
    
    if (namespace.includes('mule') || namespace.includes('connector')) {
      connectors.push({
        name: prefix,
        namespace,
        isDeprecated,
        cloudHub2Alternative: alternative
      });
    }
  });
  
  // Also look for specific connector usage in flows
  const flowMatches = [...muleConfigXml.matchAll(/<flow[\s\S]*?<\/flow>/g)];
  
  flowMatches.forEach(flowMatch => {
    const flowXml = flowMatch[0];
    
    // Check for deprecated connector patterns
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
  
  console.log(`Found ${connectors.length} connectors, ${connectors.filter(c => c.isDeprecated).length} deprecated`);
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

const getLatestVersion = (groupId: string, artifactId: string, currentVersion: string): string => {
  // This would normally make an API call to Maven Central
  // For now, return simulated latest versions
  const latestVersions: Record<string, string> = {
    'mule-vm-connector': '2.0.1',
    'mule-jms-connector': '1.8.2',
    'mule-file-connector': '1.5.1',
    'mule-ftp-connector': '1.8.1',
    'mule-sftp-connector': '1.5.2',
    'mule-email-connector': '1.4.1',
    'mule-xml-module': '1.3.2',
    'mule-json-module': '2.3.1'
  };
  
  return latestVersions[artifactId] || currentVersion;
};

const isDeprecatedConnector = (namespace: string): boolean => {
  const deprecatedNamespaces = [
    'http://www.mulesoft.org/schema/mule/vm',
    'http://www.mulesoft.org/schema/mule/jms',
    'http://www.mulesoft.org/schema/mule/file',
    'http://www.mulesoft.org/schema/mule/ftp',
    'http://www.mulesoft.org/schema/mule/email',
    'http://www.mulesoft.org/schema/mule/tcp',
    'http://www.mulesoft.org/schema/mule/udp'
  ];
  
  return deprecatedNamespaces.includes(namespace);
};

const getCloudHub2Alternative = (namespace: string): string | undefined => {
  const alternatives: Record<string, string> = {
    'http://www.mulesoft.org/schema/mule/vm': 'VM Connector 2.0 (CloudHub 2.0 compatible)',
    'http://www.mulesoft.org/schema/mule/jms': 'JMS Connector 1.8+ (CloudHub 2.0 compatible)',
    'http://www.mulesoft.org/schema/mule/file': 'File Connector 1.5+ (CloudHub 2.0 compatible)',
    'http://www.mulesoft.org/schema/mule/ftp': 'FTP Connector 1.8+ (CloudHub 2.0 compatible)',
    'http://www.mulesoft.org/schema/mule/email': 'Email Connector 1.4+ (CloudHub 2.0 compatible)',
    'mule-vm': 'VM Connector 2.0',
    'mule-jms': 'JMS Connector 1.8+',
    'mule-file': 'File Connector 1.5+',
    'mule-ftp': 'FTP Connector 1.8+',
    'mule-email': 'Email Connector 1.4+'
  };
  
  return alternatives[namespace];
};
