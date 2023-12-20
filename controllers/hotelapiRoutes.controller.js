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


const priceDroppingValue = 1;
const priceReAddedValue = 1;
const priceIncreaseValue = 1.1;

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
    data?.hotel?.rates.forEach((rate) => {

      const newBaseRate = rate.baseRate * 1.1;
      rate.baseRate = Math.ceil(newBaseRate);
    });

    return data;
  } catch (error) {
    throw error;
  }
};

const createDocumentInCosmos = async (document) => {
  const container = client.database(databaseId).container(containerId);
  await container.items.create(document);
};


//initial call to the firstcall of the zenrumhuh API to get the token , result key and hotel rates
exports.initalCallOfZentrumhub = async (req, res) => {
  const startDate = req.body.searchParams.startDate;
  const endDate = req.body.searchParams.endDate;
  const occupancies = req.body.searchParams.occupancies;
  const lat = req.body.searchParams.location.coordinates.lat;
  const long = req.body.searchParams.location.coordinates.long;
  const currency = req.body.currency;
  const ipAddress = req.body.ipAddress;
  const correlationId = req.body.correlationId;

  //calculate total days to calculate the total room nights rate
  const diffInDays = moment(endDate).diff(moment(startDate), "days");

  const outputDate = formatDate(startDate);
  const outputDate2 = formatDate(endDate);
  const rooms = req.body.searchParams.occupancies.length;
  const totalRoomNights = calculateTotalRoomNights(startDate, endDate, rooms);

  const payload = {
    channelId: ZENTRUMHUB_LIVE_CHANNEL_ID,
    segmentId: null,
    currency: currency,
    culture: ZENTRUMHUB_CULTURE,
    checkIn: outputDate,
    checkOut: outputDate2,
    occupancies: occupancies,
    circularRegion: {
      centerLat: lat,
      centerLong: long,
      radiusInKm: 30,
    },
    rectangularRegion: null,
    polygonalRegion: null,
    multiPolygonalRegion: null,
    hotelIds: null,
    nationality: ZENTRUMHUB_NATIONALITY,
    countryOfResidence: ZENTRUMHUB_COUNTRY_OF_RESIDENCE,
    destinationCountryCode: null,
    filterBy: null,
  };

  const headers = generateHeaders(ipAddress, correlationId);

  let nextKey = null;
  let noOfCallingTimes = 0;

  const getAllHotels = async (token) => {
    console.error("line 97", token);

    await axios
      .get(
        `${ZENTRUMHUB_API_URL}/availability/async/${token}/results`,
        { headers: headers }
      )
      .then((response) => {
        const data = response.data;

        if (data.status === "InProgress") {
          if (data.hotels.length === 0) {
            //calling the same api again if the response is empty with the 500 miliseconds delay
            setTimeout(() => {
              getAllHotels(token);
            }, 500);
          } else {
            data.noofrooms = rooms;
            data.noofdays = diffInDays;
            data.totalRoomNights = totalRoomNights;
            data.beforeCalculations = data.hotels;
            const modifiedData = {
              ...data,
              hotels: data.hotels.map((hotel) => {
                let pricePerRoomPerNight;
                let pricePerRoomPerNightPublish;
                let pricefortotalrooms;
                if (hotel.rate.providerName === "RateHawk") {
                  pricePerRoomPerNight =
                  (hotel.rate.totalRate / totalRoomNights) * priceDroppingValue ;
                  pricePerRoomPerNightPublish =
                    hotel.rate.baseRate / totalRoomNights;
                  const totaRateCeil = Math.ceil(hotel.rate.totalRate);
                  pricefortotalrooms =
                    totaRateCeil * priceDroppingValue;
                }else {
                  pricePerRoomPerNight =
                    (hotel.rate.totalRate / diffInDays) * priceDroppingValue ;
                  pricePerRoomPerNightPublish =
                      hotel.rate.baseRate / diffInDays;
                  const totaRateCeil = Math.ceil(hotel.rate.totalRate);
                  pricefortotalrooms =
                      totaRateCeil * rooms * priceDroppingValue;
                }
                // Calculate the new total rate with the priceDroppingValue factor
                const newTotalRate = hotel.rate.totalRate * priceDroppingValue;
                const newBaseRate = hotel.rate.baseRate * priceIncreaseValue;


                // Modify totalRate and publishedRate
                hotel.rate.totalRate = Math.ceil(newTotalRate);
                hotel.rate.baseRate = Math.ceil(newBaseRate);

                return {
                  ...hotel,
                  rate: {
                    ...hotel.rate,
                    dailyTotalRate: Math.ceil(pricePerRoomPerNight),
                    dailyPublishedRate: Math.ceil(pricePerRoomPerNightPublish * priceIncreaseValue),
                    totalTripRate: Math.ceil(pricefortotalrooms),
                  },
                };
              }),
            };
            res.status(200).json(modifiedData);
          }
        } else if (data.status === "Completed") {
          data.noofrooms = rooms;
          data.noofdays = diffInDays;
          data.totalRoomNights = totalRoomNights;

          const modifiedData = {
            ...data,
            hotels: data.hotels.map((hotel) => {
              let pricePerRoomPerNight;
                let pricePerRoomPerNightPublish;
                let pricefortotalrooms;
                if (hotel.rate.providerName === "RateHawk") {
                  pricePerRoomPerNight =
                  (hotel.rate.totalRate / totalRoomNights) * priceDroppingValue ;
                  pricePerRoomPerNightPublish =
                    hotel.rate.baseRate / totalRoomNights;
                  const totaRateCeil = Math.ceil(hotel.rate.totalRate);
                  pricefortotalrooms =
                    totaRateCeil * priceDroppingValue;
                }else {
                  pricePerRoomPerNight =
                    (hotel.rate.totalRate / diffInDays) * priceDroppingValue ;
                  pricePerRoomPerNightPublish =
                      hotel.rate.baseRate / diffInDays;
                  const totaRateCeil = Math.ceil(hotel.rate.totalRate);
                  pricefortotalrooms =
                      totaRateCeil * rooms * priceDroppingValue;
                }

              // Modify totalRate and publishedRate
              // Calculate the new total rate with the priceDroppingValue factor
              const newTotalRate = hotel.rate.totalRate * priceDroppingValue;
              const newBaseRate = hotel.rate.baseRate * priceIncreaseValue;

              // Modify totalRate and publishedRate
              hotel.rate.totalRate = Math.ceil(newTotalRate);
              hotel.rate.baseRate = Math.ceil(newBaseRate);

              return {
                ...hotel,
                rate: {
                  ...hotel.rate,
                  dailyTotalRate: Math.ceil(pricePerRoomPerNight),
                  dailyPublishedRate: Math.ceil(pricePerRoomPerNightPublish * priceIncreaseValue),
                  totalTripRate: Math.ceil(pricefortotalrooms),
                },
              };
            }),
          };
          res.status(200).json(modifiedData);
        }
      })
      .catch((error) => {
        if (noOfCallingTimes < 3) {
          noOfCallingTimes++;
          console.error("Calling the api with nextresultkey again", nextKey);

          //calling the same api again if failed to call the api with the 500 miliseconds delay
          setTimeout(() => {
            getAllHotels(token);
          }, 500);
        } else {
          console.error("line 89", error);
          //sending the empty response if the api failed to call three times
          res.status(500).json({
            hotels: [],
            token: token,
            error: "There is no result even calling the api three times",
          });
        }
      });
  };

  const initialCall = async () => {
    try {
      const zentrumhubResponse = await axios.post(
        `${ZENTRUMHUB_API_URL}/availability/init`,
        payload,
        {
          headers: headers,
        }
      );
      console.log(zentrumhubResponse);

      if (zentrumhubResponse.data.token) {
        setTimeout(() => {
          getAllHotels(zentrumhubResponse.data.token);
        }, 1500);
      } else {
        res.status(500).json({
          hotels: [],
          error:
            "An error occurred while creating a token. Please try again later",
        });
      }
    } catch (err) {
      console.log(err);
      res.status(500).json({
        hotels: [],
        error:
          "An error occurred while creating a token. Please try again later",
        data: err.data,
      });
    }
  };

  try {
    await initialCall();
  } catch (err) {
    for (let i = 0; i < 3; i++) {
      try {
        await initialCall();
        break;
      } catch (err) {
        if (i === 2) {
          res.status(500).json({
            hotels: [],
            error:
              "An error occurred while creating a token. Please try again later",
            data: err.data,
          });
          console.log(err.data);
        }
      }
    }
  }
};

//initial call to the firstcall for the ratehawk of the zenrumhuh API to get the token , result key and hotel rates
exports.initalCallOfZentrumhubRateHawk = async (req, res) => {
  const startDate = req.body.searchParams.startDate;
  const endDate = req.body.searchParams.endDate;
  const occupancies = req.body.searchParams.occupancies;
  const lat = req.body.searchParams.location.coordinates.lat;
  const long = req.body.searchParams.location.coordinates.long;
  const currency = req.body.currency;
  const ipAddress = req.body.ipAddress;
  const correlationId = req.body.correlationId;

  //calculate total days to calculate the total room nights rate
  const diffInDays = moment(endDate).diff(moment(startDate), "days");

  const outputDate = formatDate(startDate);
  const outputDate2 = formatDate(endDate);
  const rooms = req.body.searchParams.occupancies.length;
  const totalRoomNights = calculateTotalRoomNights(startDate, endDate, rooms);

  const payload = {
    channelId: ZENTRUMHUB_HB_CHANNEL_ID,
    segmentId: null,
    currency: currency,
    culture: ZENTRUMHUB_CULTURE,
    checkIn: outputDate,
    checkOut: outputDate2,
    occupancies: occupancies,
    circularRegion: {
      centerLat: lat,
      centerLong: long,
      radiusInKm: 30,
    },
    rectangularRegion: null,
    polygonalRegion: null,
    multiPolygonalRegion: null,
    hotelIds: null,
    nationality: ZENTRUMHUB_NATIONALITY,
    countryOfResidence: ZENTRUMHUB_COUNTRY_OF_RESIDENCE,
    destinationCountryCode: null,
    filterBy: null,
  };


  const headers = generateHeaders(ipAddress, correlationId);

  let nextKey = null;
  let noOfCallingTimes = 0;

  const getAllHotels = async (token) => {
    console.error("line 97", token);

    await axios
      .get(
        `${ZENTRUMHUB_API_URL}/availability/async/${token}/results`,
        { headers: headers }
      )
      .then((response) => {
        const data = response.data;

        if (data.status === "InProgress") {
          if (data.hotels.length === 0) {
            //calling the same api again if the response is empty with the 500 miliseconds delay
            setTimeout(() => {
              getAllHotels(token);
            }, 500);
          } else {
            data.noofrooms = rooms;
            data.noofdays = diffInDays;
            data.totalRoomNights = totalRoomNights;
            data.beforeCalculations = data.hotels;
            const modifiedData = {
              ...data,
              hotels: data.hotels.map((hotel) => {
                let pricePerRoomPerNight;
                let pricePerRoomPerNightPublish;
                let pricefortotalrooms;
                if (hotel.rate.providerName === "RateHawk") {
                  pricePerRoomPerNight =
                  (hotel.rate.totalRate / totalRoomNights) * priceDroppingValue ;
                  pricePerRoomPerNightPublish =
                    hotel.rate.baseRate / totalRoomNights;
                  const totaRateCeil = Math.ceil(hotel.rate.totalRate);
                  pricefortotalrooms =
                    totaRateCeil * priceDroppingValue;
                }else {
                  pricePerRoomPerNight =
                    (hotel.rate.totalRate / diffInDays) * priceDroppingValue ;
                  pricePerRoomPerNightPublish =
                      hotel.rate.baseRate / diffInDays;
                  const totaRateCeil = Math.ceil(hotel.rate.totalRate);
                  pricefortotalrooms =
                      totaRateCeil * rooms * priceDroppingValue;
                }

                // Calculate the new total rate with the priceDroppingValue factor
                const newTotalRate = hotel.rate.totalRate * priceDroppingValue;
                const newBaseRate = hotel.rate.baseRate * priceIncreaseValue;

                // Modify totalRate and publishedRate
                hotel.rate.totalRate = Math.ceil(newTotalRate);
                hotel.rate.baseRate = Math.ceil(newBaseRate);
                // Modify totalRate and publishedRate
                return {
                  ...hotel,
                  rate: {
                    ...hotel.rate,
                    dailyTotalRate: Math.ceil(pricePerRoomPerNight),
                    dailyPublishedRate: Math.ceil(pricePerRoomPerNightPublish),
                    totalTripRate: Math.ceil(pricefortotalrooms),
                  },
                };
              }),
            };
            res.status(200).json(modifiedData);
          }
        } else if (data.status === "Completed") {
          data.noofrooms = rooms;
          data.noofdays = diffInDays;
          data.totalRoomNights = totalRoomNights;

          const modifiedData = {
            ...data,
            hotels: data.hotels.map((hotel) => {
              let pricePerRoomPerNight;
                let pricePerRoomPerNightPublish;
                let pricefortotalrooms;
                if (hotel.rate.providerName === "RateHawk") {
                  pricePerRoomPerNight =
                  (hotel.rate.totalRate / totalRoomNights) * priceDroppingValue ;
                  pricePerRoomPerNightPublish =
                    hotel.rate.baseRate / totalRoomNights;
                  const totaRateCeil = Math.ceil(hotel.rate.totalRate);
                  pricefortotalrooms =
                    totaRateCeil * priceDroppingValue;
                }else {
                  pricePerRoomPerNight =
                    (hotel.rate.totalRate / diffInDays) * priceDroppingValue ;
                  pricePerRoomPerNightPublish =
                      hotel.rate.baseRate / diffInDays;
                  const totaRateCeil = Math.ceil(hotel.rate.totalRate);
                  pricefortotalrooms =
                      totaRateCeil * rooms * priceDroppingValue;
                }
              // Modify totalRate and publishedRate
              // Calculate the new total rate with the priceDroppingValue factor
              const newTotalRate = hotel.rate.totalRate * priceDroppingValue;
              const newBaseRate = hotel.rate.baseRate * priceIncreaseValue;


              // Modify totalRate and publishedRate
              hotel.rate.totalRate = Math.ceil(newTotalRate);
              hotel.rate.baseRate = Math.ceil(newBaseRate);
              return {
                ...hotel,
                rate: {
                  ...hotel.rate,
                  dailyTotalRate: Math.ceil(pricePerRoomPerNight),
                  dailyPublishedRate: Math.ceil(pricePerRoomPerNightPublish),
                  totalTripRate: Math.ceil(pricefortotalrooms),
                },
              };
            }),
          };
          res.status(200).json(modifiedData);
        }
      })
      .catch((error) => {
        if (noOfCallingTimes < 3) {
          noOfCallingTimes++;
          console.error("Calling the api with nextresultkey again", nextKey);

          //calling the same api again if failed to call the api with the 500 miliseconds delay
          setTimeout(() => {
            getAllHotels(token);
          }, 500);
        } else {
          console.error("line 89", error);
          //sending the empty response if the api failed to call three times
          res.status(500).json({
            hotels: [],
            token: token,
            error: "There is no result even calling the api three times",
          });
        }
      });
  };

  const initialCall = async () => {
    try {
      const zentrumhubResponse = await axios.post(
        `${ZENTRUMHUB_API_URL}/availability/init`,
        payload,
        {
          headers: headers,
        }
      );
      console.log(zentrumhubResponse);

      if (zentrumhubResponse.data.token) {
        setTimeout(() => {
          getAllHotels(zentrumhubResponse.data.token);
        }, 1500);
      } else {
        res.status(500).json({
          hotels: [],
          error:
            "An error occurred while creating a token. Please try again later",
        });
      }
    } catch (err) {
      console.log(err);
      res.status(500).json({
        hotels: [],
        error:
          "An error occurred while creating a token. Please try again later",
        data: err.data,
      });
    }
  };

  try {
    await initialCall();
  } catch (err) {
    for (let i = 0; i < 3; i++) {
      try {
        await initialCall();
        break;
      } catch (err) {
        if (i === 2) {
          res.status(500).json({
            hotels: [],
            error:
              "An error occurred while creating a token. Please try again later",
            data: err.data,
          });
          console.log(err.data);
        }
      }
    }
  }
};

//get the basic hotel content
exports.basicHotelContent = async (req, res) => {
  const lat = req.body?.searchParams?.location?.coordinates?.lat;
  const long = req.body?.searchParams?.location?.coordinates?.long;
  const ipAddress = req.body.ipAddress;
  const correlationId = req.body.correlationId;

  const payload = {
    channelId: ZENTRUMHUB_LIVE_CHANNEL_ID,
    destinationCountryCode: null,
    filterBy: null,
    culture: ZENTRUMHUB_CULTURE,
    contentFields: ["basic", "masterfacilities"],
    distanceFrom: {
      lat: lat,
      long: long,
    },
    circularRegion: {
      centerLat: lat,
      centerLong: long,
      radiusInKm: 30,
    },
    rectangularRegion: null,
    polygonalRegion: null,
    multiPolygonalRegion: null,
    hotelIds: null,
  };

 
  if (!ZENTRUMHUB_API_KEY || !ZENTRUMHUB_ACCOUNT_ID) {
    throw new Error("Required environment variables are not set.");
  }

  const headers = generateHeaders(ipAddress, correlationId);

  let getAllHotelsCount = 0;

  const getAllHotels = async () => {
    console.log("count", getAllHotelsCount);
    await axios
      .post(
        "https://nexus.prod.zentrumhub.com/api/content/hotelcontent/getHotelContent",
        payload,
        {
          headers: headers,
        }
      )
      .then((response) => {
        console.log("response", response.data);
        res.json(response.data);
      })
      .catch((error) => {
        if (getAllHotelsCount < 3) {
          getAllHotelsCount++;
          getAllHotels();
        } else {
          res.json(error);
        }
        // getAllHotels();
      });
  };

  try {
    // Make the API call to zentrumhub with the same data
    await getAllHotels();
  } catch (error) {
    for (let i = 0; i < 3; i++) {
      try {
        await getAllHotels();
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

//function for the nextresult key api
exports.nextAsyncHotelData = async (req, res) => {
  const { token, resultkey } = req.params;
  const { ipAddress, correlationId, totalRoomNights, noofrooms } = req.body;
  const diffInDays = req.body.noofdays;

  console.log(
    "line 15",
    token,
    resultkey,
    ipAddress,
    correlationId,
    totalRoomNights,
    noofrooms,
    diffInDays
  );
  if (!token || !resultkey) {
    res.status(500).json({
      hotels: [],
      error: "Token or resultkey is missing",
    });
  }

  if (!ZENTRUMHUB_API_KEY || !ZENTRUMHUB_ACCOUNT_ID) {
    throw new Error("Required environment variables are not set.");
  }

  const headers = generateHeaders(ipAddress, correlationId);

  console.log("inital");

  const nextResultCall = async () => {
    console.log("nextResultCall");
    try {

      const zentrumhubResponse = await axios.get(
        `${ZENTRUMHUB_API_URL}/availability/async/${token}/results?nextResultsKey=${resultkey}`,
        {
          headers: headers,
        }
      );

      const data = zentrumhubResponse.data;
      console.log(data)
      data.noofrooms = noofrooms;
      data.noofdays = diffInDays;
      data.totalRoomNights = totalRoomNights;
      // data.beforeCalculations = data.hotels;

      const modifiedData = {
        ...data,
        hotels: data.hotels.map((hotel) => {
          let pricePerRoomPerNight;
                let pricePerRoomPerNightPublish;
                let pricefortotalrooms;
                if (hotel.rate.providerName === "RateHawk") {
                  pricePerRoomPerNight =
                  (hotel.rate.totalRate / totalRoomNights) * priceDroppingValue ;
                  pricePerRoomPerNightPublish =
                    hotel.rate.baseRate / totalRoomNights;
                  const totaRateCeil = Math.ceil(hotel.rate.totalRate);
                  pricefortotalrooms =
                    totaRateCeil * priceDroppingValue;
                }else {
                  pricePerRoomPerNight =
                    (hotel.rate.totalRate / diffInDays) * priceDroppingValue ;
                  pricePerRoomPerNightPublish =
                      hotel.rate.baseRate / diffInDays;
                  const totaRateCeil = Math.ceil(hotel.rate.totalRate);
                  pricefortotalrooms =
                      totaRateCeil * noofrooms * priceDroppingValue;
                }
          // Modify totalRate and publishedRate
          // Calculate the new total rate with the priceDroppingValue factor
          const newTotalRate = hotel.rate.totalRate * priceDroppingValue;
          const newBaseRate = hotel.rate.baseRate * priceIncreaseValue;

          // Modify totalRate and publishedRate
          hotel.rate.totalRate = Math.ceil(newTotalRate);
          hotel.rate.baseRate = Math.ceil(newBaseRate);

          return {
            ...hotel,
            rate: {
              ...hotel.rate,
              dailyTotalRate: Math.ceil(pricePerRoomPerNight),
              dailyPublishedRate: Math.ceil(pricePerRoomPerNightPublish * priceIncreaseValue),
              totalTripRate: Math.ceil(pricefortotalrooms),
            },
          };
        }),
      };
      res.status(200).json(modifiedData);
    } catch (err) {
      res.status(500).json({
        hotels: [],
        error:
          "An error occurred while getting the rates from the nextresultkey. Please try again later",
        data: err.data,
        token : token ,
        resultkey : resultkey
      });
      console.log(err)
    }
  };

  try {
    // Make the API call to zentrumhub with the same data
    await nextResultCall();
  } catch (error) {
    for (let i = 0; i < 3; i++) {
      try {
        await nextResultCall();
        break;
      } catch (err) {
        if (i === 2) {
          res.status(500).json({
            hotels: [],
            error:
              "An error occurred while getting the rates from the nextresultkey. Please try again later",
            data: err.data,
            token : token ,
            resultkey : resultkey
          });
          console.log(err.data);
        }
      }
    }
  }
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
      // axiosRetry(axios, { retries: 3 });
      const response = await axios.post(
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
                               `
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