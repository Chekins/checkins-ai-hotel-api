var config = {}

config.endpoint = 'https://checkins-ai-tbo.documents.azure.com:443/'
config.key = 'G96o3A5cYvY7UxRbK7B2lWpRP10nhQpG2Nsksp7o4Xv2igXAZOtam8sF8M5V3iLLxeIIqLOYZ64MACDbFeHxSA=='

config.database = {
  id: 'checkInForGoogle'
}

config.container = {
  id: 'checkInForGoogle'
}

config.partitionKey = "partitionKey"

module.exports = config
