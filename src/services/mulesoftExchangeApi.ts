
import axios from 'axios';

const ANYPOINT_LOGIN_URL = 'https://anypoint.mulesoft.com/accounts/login';
const EXCHANGE_ASSET_URL = 'https://anypoint.mulesoft.com/exchange/api/v2/assets';

interface LoginResponse {
  access_token: string;
  redirectUrl: string;
}

interface ConnectorVersion {
  version: string;
  createdDate: string;
}

interface ConnectorAsset {
  name: string;
  groupId: string;
  assetId: string;
  versions: ConnectorVersion[];
}

class MuleSoftExchangeService {
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(
    private username: string = process.env.ANYPOINT_USERNAME || '',
    private password: string = process.env.ANYPOINT_PASSWORD || '',
    private organizationId: string = process.env.ANYPOINT_ORG_ID || ''
  ) {}

  private async loginToAnypoint(): Promise<string> {
    try {
      const response = await axios.post<LoginResponse>(ANYPOINT_LOGIN_URL, {
        username: this.username,
        password: this.password
      });
      
      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + (3600 * 1000); // Token valid for 1 hour
      
      console.log('Successfully logged into Anypoint Platform');
      return this.accessToken;
    } catch (error: any) {
      console.error('Failed to login to Anypoint Platform:', error.response?.data || error.message);
      throw new Error('Authentication failed with MuleSoft Anypoint Platform');
    }
  }

  private async getValidToken(): Promise<string> {
    if (!this.accessToken || Date.now() >= this.tokenExpiry) {
      return await this.loginToAnypoint();
    }
    return this.accessToken;
  }

  async getConnectorLatestVersion(groupId: string, assetId: string): Promise<string> {
    try {
      const token = await this.getValidToken();
      const url = `${EXCHANGE_ASSET_URL}/${groupId}/${assetId}`;
      
      const response = await axios.get<ConnectorAsset>(url, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const asset = response.data;
      if (asset.versions && asset.versions.length > 0) {
        // Versions are typically sorted by creation date descending
        const latestVersion = asset.versions[0].version;
        console.log(`Found latest version for ${assetId}: ${latestVersion}`);
        return latestVersion;
      }
      
      console.warn(`No versions found for connector ${assetId}`);
      return 'Unknown';
    } catch (error: any) {
      console.error(`Failed to get version for ${assetId}:`, error.response?.data || error.message);
      return 'Unknown';
    }
  }

  async getMultipleConnectorVersions(connectors: Array<{groupId: string, assetId: string}>): Promise<Record<string, string>> {
    const versions: Record<string, string> = {};
    
    // Process connectors in batches to avoid rate limiting
    const batchSize = 5;
    for (let i = 0; i < connectors.length; i += batchSize) {
      const batch = connectors.slice(i, i + batchSize);
      const promises = batch.map(async connector => {
        const version = await this.getConnectorLatestVersion(connector.groupId, connector.assetId);
        return { assetId: connector.assetId, version };
      });
      
      const results = await Promise.all(promises);
      results.forEach(result => {
        versions[result.assetId] = result.version;
      });
      
      // Add small delay between batches
      if (i + batchSize < connectors.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return versions;
  }

  // Map common connector artifact IDs to their Exchange counterparts
  private getExchangeMapping(artifactId: string): {groupId: string, assetId: string} | null {
    const mappings: Record<string, {groupId: string, assetId: string}> = {
      'mule-http-connector': { groupId: 'org.mule.connectors', assetId: 'mule-http-connector' },
      'mule-file-connector': { groupId: 'org.mule.connectors', assetId: 'mule-file-connector' },
      'mule-db-connector': { groupId: 'org.mule.connectors', assetId: 'mule-db-connector' },
      'mule-jms-connector': { groupId: 'org.mule.connectors', assetId: 'mule-jms-connector' },
      'mule-vm-connector': { groupId: 'org.mule.connectors', assetId: 'mule-vm-connector' },
      'mule-email-connector': { groupId: 'org.mule.connectors', assetId: 'mule-email-connector' },
      'mule-ftp-connector': { groupId: 'org.mule.connectors', assetId: 'mule-ftp-connector' },
      'mule-sftp-connector': { groupId: 'org.mule.connectors', assetId: 'mule-sftp-connector' },
      'mule-salesforce-connector': { groupId: 'com.mulesoft.connectors', assetId: 'mule-salesforce-connector' },
      'mule-workday-connector': { groupId: 'com.mulesoft.connectors', assetId: 'mule-workday-connector' },
      'mule-sap-connector': { groupId: 'com.mulesoft.connectors', assetId: 'mule-sap-connector' },
      'mule-amazon-s3-connector': { groupId: 'org.mule.connectors', assetId: 'mule-amazon-s3-connector' },
      'mule-amazon-sqs-connector': { groupId: 'org.mule.connectors', assetId: 'mule-amazon-sqs-connector' },
      'anypoint-mq-connector': { groupId: 'com.mulesoft.connectors', assetId: 'anypoint-mq-connector' }
    };

    return mappings[artifactId] || null;
  }

  async getLatestVersionForPomDependencies(dependencies: Array<{groupId: string, artifactId: string, version: string}>): Promise<Record<string, string>> {
    const connectorsToCheck: Array<{groupId: string, assetId: string}> = [];
    
    dependencies.forEach(dep => {
      const mapping = this.getExchangeMapping(dep.artifactId);
      if (mapping) {
        connectorsToCheck.push(mapping);
      }
    });

    if (connectorsToCheck.length === 0) {
      console.log('No connectors found that can be checked against Exchange');
      return {};
    }

    console.log(`Checking ${connectorsToCheck.length} connectors against MuleSoft Exchange...`);
    return await this.getMultipleConnectorVersions(connectorsToCheck);
  }
}

export default MuleSoftExchangeService;
