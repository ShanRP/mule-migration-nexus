const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 5000;

// Configure CORS with specific options
app.use(cors({
  origin: ['http://localhost:8080', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());

// Function to get OAuth token
async function getOAuthToken() {
    // TODO: Replace with your Anypoint Platform username and password
    const username = 'haridhanamjothi'; 
    const password = 'abcABC!@#1';

    try {
        console.log('Attempting to get OAuth token using username/password login...');
        const response = await axios.post(
            'https://anypoint.mulesoft.com/accounts/login',
            {
                "username": username,
                "password": password
                },
            { 
                headers: { 
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log('Successfully obtained OAuth token.');
        return response.data.access_token;
    } catch (error) {
        console.error('Error fetching OAuth token using username/password login:', error.response?.data || error.message);
        // Log full error response for debugging
        if (axios.isAxiosError(error) && error.response) {
            console.error('Full OAuth login API error response:', {
                status: error.response.status,
                headers: error.response.headers,
                data: error.response.data,
                message: error.message
            });
        }
        throw error;
    }
}

// Mapping of artifactIds to Anypoint Exchange API names
const connectorNameMapping = {
    'mule-marketo-connector': 'Marketo-Connector',
    'mule-oauth-module': 'OAuth-Module',
    'mule-amazon-ec2-connector': 'Amazon-EC2-Connector',
    'mule-amazon-s3-connector': 'Amazon-S3-Connector',
    'mule-amazon-sns-connector': 'Amazon-SNS-Connector',
    'mule-amazon-sqs-connector': 'Amazon-SQS-Connector',
    'mule-amqp-connector': 'AMQP-Connector',
    'anypoint-mq-connector': 'Anypoint-MQ-Connector',
    'mule-cassandradb-connector': 'CassandraDB-Connector',
    'mule-kafka-connector': 'Kafka-Connector',
    'mule-azure-service-bus-connector': 'Azure-Service-Bus-Connector',
    'mule-box-connector': 'Box-Connector',
    'mule-file-connector': 'File-Connector',
    'mule-db-connector': 'DB-Connector',
    'mule-cloudhub-connector': 'CloudHub-Connector',
    'mule-http-connector': 'HTTP-Connector',
    'mule-ftp-connector': 'FTP-Connector',
    'mule-email-connector': 'Email-Connector',
    'mule-microsoft-dotnet-connector': 'Microsoft-DotNet-Connector',
    'mule-jms-connector': 'JMS-Connector',
    'mule-ldap-connector': 'LDAP-Connector',
    'mule-microsoft-dynamics-gp-connector': 'Microsoft-Dynamics-GP-Connector',
    'mule-microsoft-dynamics-crm-connector': 'Microsoft-Dynamics-CRM-Connector',
    'mule-microsoft-service-bus-connector': 'Microsoft-Service-Bus-Connector',
    'mule-objectstore-connector': 'ObjectStore-Connector',
    'mule-module-file-extension-common': 'File-Extension-Common-Module',
    'mule-powershell-connector': 'PowerShell-Connector',
    'mule-mongodb-connector': 'MongoDB-Connector',
    'mule-hdfs-connector': 'HDFS-Connector',
    'mule-sharepoint-connector': 'SharePoint-Connector',
    'mule-neo4j-connector': 'Neo4j-Connector',
    'mule-peoplesoft-connector': 'PeopleSoft-Connector',
    'mule-oracle-ebs-122-connector': 'Oracle-EBS-122-Connector',
    'mule-netsuite-openair-connector': 'NetSuite-OpenAir-Connector',
    'mule-netsuite-connector': 'NetSuite-Connector',
    'mule-redis-connector': 'Redis-Connector',
    'mule-salesforce-composite-connector': 'Salesforce-Composite-Connector',
    'mule-salesforce-connector': 'Salesforce-Connector',
    'mule-rosettanet-connector': 'RosettaNet-Connector',
    'mule-sfdc-analytics-connector': 'SFDC-Analytics-Connector',
    'mule-sfdc-marketing-cloud-connector': 'SFDC-Marketing-Cloud-Connector',
    'mule-sap-concur-connector': 'SAP-Concur-Connector',
    'mule-sftp-connector': 'SFTP-Connector',
    'mule-sap-connector': 'SAP-Connector',
    'mule-servicenow-connector': 'ServiceNow-Connector',
    'mule-wsc-connector': 'WSC-Connector',
    'mule-workday-connector': 'Workday-Connector',
    'mule-zuora-connector': 'Zuora-Connector',
    'mule-twilio-connector': 'Twilio-Connector',
    'mule-sockets-connector': 'Sockets-Connector',
    'mule-xml-module': 'XML-Module'
};

// Endpoint to fetch connector version
app.get('/api/connector-version', async (req, res) => {
    const artifactId = req.query.name; // Get artifactId from query
    
    if (!artifactId) {
        return res.status(400).json({ error: 'Artifact ID is required' });
    }

    // We will now use search and type parameters as 'name' seems inconsistent
    const apiConnectorSearchTerm = artifactId; 
    const type = 'extension';

    try {
        const oauthToken = await getOAuthToken();
        
        // Construct the API URL using search and type
        const apiUrl = `https://anypoint.mulesoft.com/exchange/api/v1/assets?search=${encodeURIComponent(apiConnectorSearchTerm)}&type=${encodeURIComponent(type)}`;

        console.log(`Attempting to search for connector version from Anypoint Exchange API: ${apiUrl}`);

        const response = await axios.get(
            apiUrl,
            { 
                headers: { 
                    Authorization: `Bearer a0fddbf2-62d5-4471-b7ab-c4bcc2811538`,
                    // 'Accept': 'application/json'
                }
            }
        );

        // The response data is an array of assets matching the search term
        const assets = response.data.data;

        if (!assets || assets.length === 0) {
            console.log(`No assets found in Anypoint Exchange API for search term: ${apiConnectorSearchTerm}`);
            return res.status(404).json({ 
                error: 'Connector data not found in Anypoint Exchange',
                details: `No assets found in Anypoint Exchange API for search term: ${apiConnectorSearchTerm}`
            });
        }

        // Find the asset that exactly matches the requested artifactId
        const targetAsset = assets.find(asset => asset.assetId === artifactId);

        if (!targetAsset) {
             console.log(`No asset found with exact artifactId: ${artifactId} in search results`);
             return res.status(404).json({ 
                 error: 'Connector data not found in Anypoint Exchange',
                 details: `No asset found with artifactId: ${artifactId} in search results`
             });
        }

        // Extract the version from the target asset
        const latestVersion = targetAsset.version;

        console.log(`Found version ${latestVersion} for artifactId: ${artifactId}`);
        res.json({ 
            version: latestVersion,
            artifactId: artifactId
        });

    } catch (error) {
        console.error('Error fetching connector version from Anypoint Exchange:', error.response?.data?.details || error.message);
        
        // Log the full error response if available
        if (axios.isAxiosError(error)) {
            console.error('Full Anypoint Exchange API error response:', {
                status: error.response?.status,
                headers: error.response?.headers,
                data: error.response?.data,
                message: error.message,
                url: error.config?.url // Log the URL that failed
            });
        }

        res.status(error.response?.status || 500).json({ 
            error: 'Failed to fetch connector version from Anypoint Exchange',
            details: error.response?.data?.details || error.message
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        error: 'Internal server error',
        details: err.message
    });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
