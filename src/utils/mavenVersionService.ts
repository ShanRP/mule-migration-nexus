
import axios from 'axios';

interface MavenDependency {
  groupId: string;
  artifactId: string;
  currentVersion: string;
}

interface VersionUpdate {
  groupId: string;
  artifactId: string;
  currentVersion: string;
  latestVersion: string;
  available: boolean;
}

// Maven Central API service for getting latest versions
export class MavenVersionService {
  private static readonly MAVEN_CENTRAL_API = 'https://search.maven.org/solrsearch/select';
  private static readonly BATCH_SIZE = 10;
  private static versionCache = new Map<string, { version: string; timestamp: number }>();
  private static readonly CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

  /**
   * Get the latest version for a single dependency from Maven Central
   */
  static async getLatestVersion(groupId: string, artifactId: string): Promise<string> {
    const cacheKey = `${groupId}:${artifactId}`;
    const cached = this.versionCache.get(cacheKey);
    
    // Return cached version if still valid
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      console.log(`Using cached version for ${cacheKey}: ${cached.version}`);
      return cached.version;
    }

    try {
      console.log(`Fetching latest version for ${groupId}:${artifactId} from Maven Central...`);
      
      const response = await axios.get(this.MAVEN_CENTRAL_API, {
        params: {
          q: `g:"${groupId}" AND a:"${artifactId}"`,
          rows: 1,
          wt: 'json'
        },
        timeout: 10000 // 10 second timeout
      });

      if (response.data?.response?.docs?.length > 0) {
        const latestVersion = response.data.response.docs[0].latestVersion;
        console.log(`Found latest version for ${cacheKey}: ${latestVersion}`);
        
        // Cache the result
        this.versionCache.set(cacheKey, {
          version: latestVersion,
          timestamp: Date.now()
        });
        
        return latestVersion;
      } else {
        console.warn(`No version found for ${groupId}:${artifactId}`);
        return '';
      }
    } catch (error) {
      console.error(`Error fetching version for ${groupId}:${artifactId}:`, error);
      return '';
    }
  }

  /**
   * Get latest versions for multiple dependencies in batches
   */
  static async getLatestVersionsBatch(dependencies: MavenDependency[]): Promise<VersionUpdate[]> {
    console.log(`Fetching latest versions for ${dependencies.length} dependencies...`);
    
    const results: VersionUpdate[] = [];
    
    // Process dependencies in batches to avoid overwhelming the API
    for (let i = 0; i < dependencies.length; i += this.BATCH_SIZE) {
      const batch = dependencies.slice(i, i + this.BATCH_SIZE);
      
      const batchPromises = batch.map(async (dep) => {
        const latestVersion = await this.getLatestVersion(dep.groupId, dep.artifactId);
        return {
          groupId: dep.groupId,
          artifactId: dep.artifactId,
          currentVersion: dep.currentVersion,
          latestVersion: latestVersion || dep.currentVersion,
          available: latestVersion && latestVersion !== dep.currentVersion
        };
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Add a small delay between batches to be respectful to the API
      if (i + this.BATCH_SIZE < dependencies.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    console.log(`Completed fetching versions. Found updates for ${results.filter(r => r.available).length} dependencies.`);
    return results;
  }

  /**
   * Parse Maven versions:display-dependency-updates output
   * This would be used if we had access to run Maven commands server-side
   */
  static parseMavenVersionsOutput(output: string): VersionUpdate[] {
    const updates: VersionUpdate[] = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      // Parse lines like: [INFO]   com.mulesoft.connectors:mule-salesforce-connector ......... 10.18.0 -> 11.1.0
      const match = line.match(/\[INFO\]\s+([^:]+):([^\s]+)\s+.*?\s+([^\s]+)\s+->\s+([^\s]+)/);
      if (match) {
        const [, groupId, artifactId, currentVersion, latestVersion] = match;
        updates.push({
          groupId: groupId.trim(),
          artifactId: artifactId.trim(),
          currentVersion: currentVersion.trim(),
          latestVersion: latestVersion.trim(),
          available: true
        });
      }
    }
    
    return updates;
  }

  /**
   * Get latest versions for known Mule connectors using predefined list
   */
  static async getLatestMuleConnectorVersions(): Promise<Record<string, string>> {
    const muleConnectors = [
      { groupId: 'org.mule.connectors', artifactId: 'mule-http-connector' },
      { groupId: 'org.mule.connectors', artifactId: 'mule-file-connector' },
      { groupId: 'org.mule.connectors', artifactId: 'mule-ftp-connector' },
      { groupId: 'org.mule.connectors', artifactId: 'mule-sftp-connector' },
      { groupId: 'org.mule.connectors', artifactId: 'mule-email-connector' },
      { groupId: 'org.mule.connectors', artifactId: 'mule-jms-connector' },
      { groupId: 'org.mule.connectors', artifactId: 'mule-vm-connector' },
      { groupId: 'org.mule.connectors', artifactId: 'mule-db-connector' },
      { groupId: 'org.mule.connectors', artifactId: 'mule-salesforce-connector' },
      { groupId: 'org.mule.connectors', artifactId: 'mule-workday-connector' },
      { groupId: 'org.mule.connectors', artifactId: 'mule-servicenow-connector' },
      { groupId: 'org.mule.connectors', artifactId: 'mule-netsuite-connector' },
      { groupId: 'org.mule.connectors', artifactId: 'mule-sap-connector' },
      { groupId: 'org.mule.connectors', artifactId: 'mule-kafka-connector' },
      { groupId: 'org.mule.connectors', artifactId: 'mule-amazon-s3-connector' },
      { groupId: 'org.mule.connectors', artifactId: 'mule-amazon-sqs-connector' },
      { groupId: 'org.mule.connectors', artifactId: 'mule-wsc-connector' },
      { groupId: 'org.mule.modules', artifactId: 'mule-xml-module' },
      { groupId: 'org.mule.modules', artifactId: 'mule-json-module' },
      { groupId: 'com.mulesoft.connectors', artifactId: 'anypoint-mq-connector' }
    ];

    const dependencies = muleConnectors.map(conn => ({
      groupId: conn.groupId,
      artifactId: conn.artifactId,
      currentVersion: '0.0.0' // We just want the latest version
    }));

    const versionUpdates = await this.getLatestVersionsBatch(dependencies);
    const versionsMap: Record<string, string> = {};

    versionUpdates.forEach(update => {
      versionsMap[update.artifactId] = update.latestVersion;
    });

    return versionsMap;
  }

  /**
   * Clear the version cache
   */
  static clearCache(): void {
    this.versionCache.clear();
    console.log('Maven version cache cleared');
  }
}
