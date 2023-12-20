require("dotenv").config();
const axios = require("axios");
const moment = require("moment");
const CosmosClient = require('@azure/cosmos').CosmosClient
const config = require('../config/cosmo.config')
const { v4: uuidv4 } = require('uuid');
const axiosRetry = require('axios-retry');
// const winston = require('winston');

const endpoint = config.endpoint
const key = config.key

const databaseId = config.database.id
const containerId = config.container.id

const options = {
  endpoint: endpoint,
  key: key,
  userAgentSuffix: 'CosmosDBJavascriptQuickstart'
};
const client = new CosmosClient(options)

const ZENTRUMHUB_API_URL="https://nexus.prod.zentrumhub.com/api/hotel"
const ZENTRUMHUB_API_KEY="e7813f66-2ac8-4f64-a7cd-6ab58e0e5194"
const ZENTRUMHUB_ACCOUNT_ID="chekins-live-account"
const ZENTRUMHUB_LIVE_CHANNEL_ID="ci-live-channel"
const ZENTRUMHUB_HB_CHANNEL_ID="ci-hbb2clive-channel"
const ZENTRUMHUB_COUNTRY_OF_RESIDENCE="US"
const ZENTRUMHUB_NATIONALITY="US"
const ZENTRUMHUB_CULTURE="en-us"

//formatting the date to YYYY-MM-DD format to match the API requirement
const formatDate = (date) => {
  const momentDate = moment(date).utcOffset(0, true);
  return momentDate.format("YYYY-MM-DD");
};

//calculate total room nights
const calculateTotalRoomNights = (startDate, endDate, rooms) => {
  const momentDate = moment(startDate).utcOffset(0, true);
  const momentDate2 = moment(endDate).utcOffset(0, true);
  const diffInDay = momentDate2.diff(momentDate, "days");
  return diffInDay * rooms;
};

//generate headers for the API call
const generateHeaders = (ipAddress, correlationId) => {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Accept-Encoding": "gzip,deflate,compress",
    apiKey: ZENTRUMHUB_API_KEY,
    accountId: ZENTRUMHUB_ACCOUNT_ID,
    "customer-ip": ipAddress,
    correlationId: correlationId,
  };
};

const handleError = (res, error, message) => {
  console.error(message, error);
  res.status(500).json({
    hotels: [],
    error: message,
    data: error.data || null,
  });
};

const getRoomDataFromCosmos = async (querySpec) => {
  try {
    const { resources: results } = await client
      .database(databaseId)
      .container(containerId)
      .items.query(querySpec)
      .fetchAll();

    return results.length > 0 ? results[0] : null;
  } catch (error) {
    throw error;
  }
};

const postRoomDataToAPI = async (payload , HotelID , headers) => {
  try {
    const response = await axios.post(
      `${ZENTRUMHUB_API_URL}/${HotelID}/roomsandrates`,
      payload,
      { headers }
    );

    const data = response.data;
    if (data?.error || data === '') {
      throw new Error('Error in API response');
    }

    return data;
  } catch (error) {
    throw error;
  }
};

const createDocumentInCosmos = async (document) => {
  const container = client.database(databaseId).container(containerId);
  await container.items.create(document);
};



//function for the single hotel data
exports.singleHotelData = async (req, res) => {
  const { id, ipAddress, correlationId } = req.body;

  const payload = {
    channelId: ZENTRUMHUB_LIVE_CHANNEL_ID,
    culture: ZENTRUMHUB_CULTURE,
    includeAllProviders: true,
    hotelIds: [id],
    filterBy: null,
    contentFields: ["All"],
  };
  const headers = generateHeaders(ipAddress, correlationId);

  const singleHotelData = async () => {
    try {
      const response = await axiosRetry(axios, {
        retries: 3,
        retryDelay: axiosRetry.exponentialDelay,
      }).post(
        "https://nexus.prod.zentrumhub.com/api/content/hotelcontent/getHotelContent",
        payload,
        {
          headers: headers,
        }
      );
      console.log(response.data);
      res.status(200).json(response.data);
    } catch (error) {
      console.log("line 158", error);
      res.status(500).json({
        hotels: [],
        error: "A system error occurred. Try again after some time ",
      });
    }
  };

  // const logger = winston.createLogger({
  //   level: 'info',
  //   format: winston.format.json(),
  //   transports: [
  //     new winston.transports.Console(),
  //     new winston.transports.File({ filename: 'logs.log' })
  //   ]
  // });

  try {
    // Make the API call to zentrumhub with the same data
    await singleHotelData();
  } catch (error) {
    for (let i = 0; i < 3; i++) {
      try {
        await singleHotelData();
        break;
      } catch (err) {
        if (i === 2) {
          res.status(500).json({
            hotels: [],
            error:
              "An error occurred while getting the hotel content. Please try again later",
            data: err.data,
          });
          console.log(err.data);
        }
      }
    }
  }
};

exports.initRoomAndRatesToken = async (req, res) => {
  const {
    ipAddress,
    correlationId,
    checkIn,
    checkOut,
    occupancies,
    currency,
    id,
  } = req.body;

  //calculate total days to calculate the total room nights rate
  const diffInDays = moment(checkOut).diff(moment(checkIn), "days");

  const outputDate = formatDate(checkIn);
  const outputDate2 = formatDate(checkOut);
  const rooms = occupancies.length;
  const totalRoomNights = calculateTotalRoomNights(checkIn, checkOut, rooms);

  const payload = {
    channelId: ZENTRUMHUB_HB_CHANNEL_ID,
    currency: currency,
    culture: ZENTRUMHUB_CULTURE,
    checkIn: outputDate,
    checkOut: outputDate2,
    occupancies: occupancies,
    nationality: ZENTRUMHUB_NATIONALITY,
    countryOfResidence: ZENTRUMHUB_COUNTRY_OF_RESIDENCE,
  };

  const headers = generateHeaders(ipAddress, correlationId);

  const HotelID = parseInt(id);

  const MAX_RETRY_COUNT = 3;
  let roomAndRatesTokenAPICount = 0;
  
  const getRoomData = async () => {
    const querySpec = {
      query: 'SELECT * FROM root r WHERE r.checkIn = @checkIn AND r.checkOut = @checkOut AND r.hotel.id = @hotelId',
      parameters: [
        { name: '@checkIn', value: outputDate },
        { name: '@checkOut', value: outputDate2 },
        { name: '@hotelId', value: id },
      ],
    };
  
    try {
      const retrievedItem = await getRoomDataFromCosmos(querySpec);
  
      if (retrievedItem) {
        retrievedItem.totalRoomNights = totalRoomNights;
        retrievedItem.diffInDays = diffInDays;
        return res.status(200).json(retrievedItem);
      }
  
      const data = await postRoomDataToAPI(payload , HotelID ,headers);
      data.totalRoomNights = totalRoomNights;
      data.diffInDays = diffInDays;
  
      // Concurrently run both operations
      await Promise.all([
        createDocumentInCosmos({
          token: data.token,
          currency: data.currency,
          checkIn: outputDate,
          checkOut: outputDate2,
          hotel: data.hotel,
        }),
        res.status(200).json(data),
      ]);
    } catch (error) {
      console.log('An error occurred:', error);
  
      if (roomAndRatesTokenAPICount < MAX_RETRY_COUNT) {
        roomAndRatesTokenAPICount++;
        await getRoomData();
      } else {
        handleError(res, error, 'An error occurred while getting room data');
      }
    }
  };
  
  try {
    // Make the API call to zentrumhub with the same data
    await getRoomData();
  } catch (error) {
    for (let i = 0; i < 3; i++) {
      try {
        await getRoomData();
        break;
      } catch (err) {
        if (i === 2) {
          res.status(500).json({
            hotels: [],
            error:
              "An error occurred while getting the rates for the rooms. Please try again later",
            data: err.data,
          });
          console.log(err);
        }
      }
    }
  }
};

//re checking the price by recommendation id after selecting the room and rate
exports.priceCheckingRecommendation = async (req, res) => {
  const {
    ipAddress,
    correlationId,
    id,
    roomtoken,
    selectedRecommendation,
  } = req.body;

  const headers = generateHeaders(ipAddress, correlationId);

  let priceCheckingRecommendationCount = 0;

  const priceCheckingRecommendation = async () => {
    await axios
      .get(
        `${ZENTRUMHUB_API_URL}/${id}/${roomtoken}/price/recommendation/${selectedRecommendation}`,
        {
          headers: headers,
        }
      )
      .then((response) => {
        console.log(response);
        const data = response.data;

        res.status(200).json(data);
      })
      .catch((error) => {
        if (priceCheckingRecommendationCount < 3) {
          priceCheckingRecommendationCount++;
          priceCheckingRecommendation();
        } else {
          console.log("line 158", error);
          res
            .status(500)
            .json({ error: "An error occurred while getting data" });
        }
      });
  };

  try {
    // Make the API call to zentrumhub with the same data
    await priceCheckingRecommendation();
  } catch (error) {
    for (let i = 0; i < 3; i++) {
      try {
        await priceCheckingRecommendation();
        break;
      } catch (err) {
        if (i === 2) {
          res
            .status(500)
            .json({ error: "An error occurred while getting data" });
          console.log(err.data);
        }
      }
    }
  }
};

//booking the room api
exports.roomBookingZentrumhub = async (req, res) => {
  const { data, ipAddress, correlationId, hotelId, roomtoken } = req.body;

  const headers = generateHeaders(ipAddress, correlationId);

  const zentrumhubBookingAPI = async () => {
    await axios
      .post(
        `${ZENTRUMHUB_API_URL}/${hotelId}/${roomtoken}/book`,
        data,
        {
          headers: headers,
        }
      )
      .then((response) => {
        console.log(response);
        res.status(200).json(response.data);
      })
      .catch((error) => {
        console.log(error);
        res.status(500).json({ error: "An error occurred while booking" });
      });
  };

  try {
    // Make the API call to zentrumhub with the same data
    await zentrumhubBookingAPI();
  } catch (error) {
    for (let i = 0; i < 3; i++) {
      try {
        await zentrumhubBookingAPI();
        break;
      } catch (err) {
        if (i === 2) {
          res.status(500).json({ error: "An error occurred while booking" });
          console.log(err.data);
        }
      }
    }
  }
};

exports.hotelsForGoogleBlockedMethodWithRooms = async (req, res) => {

    const { Query } = req.body; // Destructure the request body

    const { Checkin, Nights, PropertyList } = Query; // Destructure properties from the Query object

    const correlationId = uuidv4();
    const ipAddress = "192.168.1.1";

    const hotelIds = PropertyList[0].Property; // Extract hotel IDs from PropertyList
    const ids = hotelIds;

    const headers = generateHeaders(ipAddress, correlationId);

    const check_In = formatDate(Checkin[0]);
    const check_Out = formatDate(moment(Checkin[0]).add(Nights, "days")); // Calculate checkOut date
  try {

    //payload for the rates api
    const payloadRate = {
      channelId: ZENTRUMHUB_HB_CHANNEL_ID,
      currency: "USD",
      culture: ZENTRUMHUB_CULTURE,
      checkIn: check_In,
      checkOut: check_Out,
      occupancies: [
        {
          numOfAdults: 2,
          childAges: [],
        },
      ],
      nationality: ZENTRUMHUB_NATIONALITY,
      countryOfResidence: ZENTRUMHUB_COUNTRY_OF_RESIDENCE,
    };

    //function to get the rates for each hotel
    const getAllRatesHotels = async (id) => {
      try {

        try{
          const querySpec = {
            query: 'SELECT * FROM root r WHERE r.checkIn = @checkIn AND r.checkOut = @checkOut AND r.hotel.id = @hotelId',
            parameters: [
              { name: '@checkIn', value: check_In },
              { name: '@checkOut', value: check_Out },
              { name: '@hotelId', value: id }, // Replace with the actual hotel ID
            ],
          };
          const { resources: results } = await client
            .database(databaseId)
            .container(containerId)
            .items.query(querySpec)
            .fetchAll();
  
          if (results.length > 0) {
            const retrievedItem = results[0]; // Assuming there's only one matching item
            // console.log(`Retrieved item:\n${JSON.stringify(retrievedItem, null, 2)}`);
            console.log("ITEM FOUND")
            return retrievedItem;
          } else {
            console.log("ITEM NOT FOUND")
  
            const response = await axios.post(
              `${ZENTRUMHUB_API_URL}/${id}/roomsandrates`,
              payloadRate,
              {
                headers: headers,
              }
            );
            const data = response.data;
            if (data?.error) {
              // Ignore this response with 'No results found.' error
              return null;
            }
            return data;
          }
        }catch(err){
          const response = await axios.post(
            `${ZENTRUMHUB_API_URL}/${id}/roomsandrates`,
            payloadRate,
            {
              headers: headers,
            }
          );
          const data = response.data;
          if (data?.error) {
            // Ignore this response with 'No results found.' error
            return null;
          }
          return data;
        }

      } catch (error) {
        throw error;
      }
    };

    async function isItemExists(querySpec) {
      try {
        const { resources: results } = await client
          .database(databaseId)
          .container(containerId)
          .items.query(querySpec)
          .fetchAll();
    
        return results.length > 0; // If there are results, the item exists
      } catch (error) {
        console.error(error);
        return false; // Handle the error as needed
      }
    }

      try {
        const hotelPromises = hotelIds.map(getAllRatesHotels);
        Promise.all(hotelPromises)
          .then(async (results) => {
            try {
              const validResults = results.filter((result) => {
                return result !== null && result !== undefined && result !== "";
              });
              // Check and store data in Cosmos DB
              await Promise.all(validResults.map(async (result) => {
                const container = client.database(databaseId).container(containerId);
                // Example query to check if an item exists based on certain criteria
                const querySpec = {
                  query: 'SELECT * FROM root r WHERE r.checkIn = @checkIn AND r.checkOut = @checkOut AND r.hotel.id = @hotelId',
                  parameters: [
                    { name: '@checkIn', value: check_In },
                    { name: '@checkOut', value: check_Out },
                    { name: '@hotelId', value: result.hotel.id }, // Replace with the actual hotel ID
                  ],
                };

                const itemExists = await isItemExists(querySpec);

                if (itemExists) {
                  
                  console.log(`Item with checkIn ${check_In}, checkOut ${check_Out}, and hotelId ${result.hotel.id} exists.`);

                } else {
                  const document = {
                    token: result.token,
                    currency: result.currency,
                    checkIn: check_In,
                    checkOut: check_Out,
                    hotel: result.hotel,
                  };

                  await container.items.create(document);
                  console.log(`Item with checkIn ${check_In}, checkOut ${check_Out}, and hotelId ${result.hotel.id} does not exist.`);
                }
              
              }));

              const xmlResults = hotelIds
                .map((hotelId) => {
                  const hotel = validResults.find(
                    (h) => h && h?.hotel && h?.hotel?.id === hotelId
                  );

                  if (hotel) {
                    const totalRateCeil = Math.ceil(
                      hotel.hotel.rates[0].totalRate
                    );
                    console.log("totalRateCeil", totalRateCeil);
                    return `
                              <Result>
                                <Property>${hotel.hotel.id}</Property>
                                <Checkin>${check_In}</Checkin>
                                <Nights>${Nights}</Nights>
                                ${
                                  totalRateCeil > 9900
                                    ? `<Unavailable>
                                  <NoVacancy/>
                                </Unavailable>`
                                    : `<Baserate currency="USD">${totalRateCeil.toFixed(
                                        2
                                      )}</Baserate>
                                <OtherFees currency="USD">20</OtherFees>`
                                }
                              </Result>`;
                  } else {
                    return `
                        <Result>
                          <Property>${hotelId}</Property>
                          <Checkin>${check_In}</Checkin>
                          <Nights>${Nights}</Nights>
                          <Unavailable>
                            <NoVacancy/>
                          </Unavailable>
                        </Result>`;
                  }
                })
                .join("");

              const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                                    <Transaction timestamp="${new Date().toISOString()}" id="${correlationId}">
                                      ${xmlResults}
                                    </Transaction>`;

              res.set("Content-Type", "application/xml");
              res.status(200).send(xmlResponse);

            } catch (err) {
              console.log(err);
              const xmlResults =
                hotelIds &&
                hotelIds
                  .map((hotelId) => {
                    return `
              <Result>
                <Property>${hotelId}</Property>
                <Checkin>${check_In}</Checkin>
                <Nights>${Nights}</Nights>
                <Unavailable>
                  <NoVacancy/>
                </Unavailable>
              </Result>`;
                  })
                  .join("");
              const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
            <Transaction timestamp="${new Date().toISOString()}" id="${correlationId}">
              ${xmlResults}
            </Transaction>`;

              res.set("Content-Type", "application/xml");
              res.status(200).send(xmlResponse);
            }
          })
          .catch((error) => {
            console.error(error);
            const xmlResults =
              hotelIds &&
              hotelIds
                .map((hotelId) => {
                  return `
              <Result>
                <Property>${hotelId}</Property>
                <Checkin>${check_In}</Checkin>
                <Nights>${Nights}</Nights>
                <Unavailable>
                  <NoVacancy/>
                </Unavailable>
              </Result>`;
                })
                .join("");
            const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
            <Transaction timestamp="${new Date().toISOString()}" id="${correlationId}">
              ${xmlResults}
            </Transaction>`;

            res.set("Content-Type", "application/xml");
            res.status(200).send(xmlResponse);
          });
      } catch (error) {
        const xmlResults =
          ids &&
          ids
            .map((hotelId) => {
              return `
      <Result>
        <Property>${hotelId}</Property>
        <Checkin>${check_In}</Checkin>
        <Nights>${Nights}</Nights>
        <Unavailable>
          <NoVacancy/>
        </Unavailable>
      </Result>`;
            })
            .join("");
        const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Transaction timestamp="${new Date().toISOString()}" id="${correlationId}">
        ${xmlResults}
      </Transaction>`;

        res.set("Content-Type", "application/xml");
        res.status(200).send(xmlResponse);
      }
  } catch (error) {
    console.log(error);
    const xmlResults =
      ids &&
      ids
        .map((hotelId) => {
          return `
    <Result>
      <Property>${hotelId}</Property>
      <Checkin>${check_In}</Checkin>
      <Nights>${Nights}</Nights>
      <Unavailable>
        <NoVacancy/>
      </Unavailable>
    </Result>`;
        })
        .join("");
    const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
    <Transaction timestamp="${new Date().toISOString()}" id="${correlationId}">
      ${xmlResults}
    </Transaction>`;

    res.set("Content-Type", "application/xml");
    res.status(200).send(xmlResponse);
  }
};