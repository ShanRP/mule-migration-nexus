
import { corsHeaders } from '../_shared/cors.ts';

const serve = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const artifactId = url.searchParams.get('name');
    
    if (!artifactId) {
      return new Response(
        JSON.stringify({ error: 'Artifact ID is required' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Fetching connector version for: ${artifactId}`);

    // Static version mapping as fallback
    const staticVersions: Record<string, string> = {
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

    // Function to get OAuth token using Anypoint credentials
    async function getOAuthToken(): Promise<string> {
      const username = Deno.env.get('ANYPOINT_USERNAME');
      const password = Deno.env.get('ANYPOINT_PASSWORD');

      if (!username || !password) {
        throw new Error('Anypoint credentials not configured');
      }

      console.log('Attempting to get OAuth token...');
      
      const response = await fetch('https://anypoint.mulesoft.com/accounts/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: username,
          password: password
        })
      });

      if (!response.ok) {
        console.error('OAuth login failed:', response.status, response.statusText);
        throw new Error(`OAuth login failed: ${response.status}`);
      }

      const data = await response.json();
      console.log('Successfully obtained OAuth token');
      return data.access_token;
    }

    // Function to fetch version from Anypoint Exchange API
    async function fetchFromAnypointExchange(artifactId: string): Promise<string | null> {
      try {
        console.log(`Searching Anypoint Exchange for: ${artifactId}`);
        
        // Try to get OAuth token first
        let oauthToken: string;
        try {
          oauthToken = await getOAuthToken();
        } catch (error) {
          console.error('Failed to get OAuth token:', error);
          return null;
        }

        // Search for the connector using the artifactId
        const searchUrl = `https://anypoint.mulesoft.com/exchange/api/v1/assets?search=${encodeURIComponent(artifactId)}&type=extension`;
        
        console.log(`Searching at URL: ${searchUrl}`);
        
        const searchResponse = await fetch(searchUrl, {
          headers: {
            'Authorization': `Bearer ${oauthToken}`,
            'Accept': 'application/json'
          }
        });

        if (!searchResponse.ok) {
          console.error(`Search API failed: ${searchResponse.status} ${searchResponse.statusText}`);
          return null;
        }

        const searchData = await searchResponse.json();
        console.log(`Search returned ${searchData.length} results`);

        if (!searchData || searchData.length === 0) {
          console.log(`No assets found for: ${artifactId}`);
          return null;
        }

        // Find the exact match by assetId
        const targetAsset = searchData.find((asset: any) => asset.assetId === artifactId);

        if (!targetAsset) {
          console.log(`No exact match found for assetId: ${artifactId}`);
          return null;
        }

        const version = targetAsset.version;
        console.log(`Found version ${version} for ${artifactId} from Anypoint Exchange`);
        return version;

      } catch (error) {
        console.error(`Error fetching from Anypoint Exchange for ${artifactId}:`, error);
        return null;
      }
    }

    // Try to fetch from Anypoint Exchange API first (main priority)
    let latestVersion = await fetchFromAnypointExchange(artifactId);

    // If API call fails, use static version as fallback
    if (!latestVersion) {
      latestVersion = staticVersions[artifactId];
      if (latestVersion) {
        console.log(`Using static fallback version ${latestVersion} for ${artifactId}`);
      } else {
        console.log(`No version found for ${artifactId} in static mapping`);
        return new Response(
          JSON.stringify({ 
            error: 'Connector data not found',
            details: `No version information available for ${artifactId}`
          }),
          { 
            status: 404, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
    }

    return new Response(
      JSON.stringify({ 
        version: latestVersion,
        artifactId: artifactId,
        source: latestVersion === staticVersions[artifactId] ? 'static' : 'anypoint-exchange'
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in mule-connector-versions function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: error.message
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
};

Deno.serve(serve);
