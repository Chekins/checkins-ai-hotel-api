require("dotenv").config();
const axios = require("axios");
const { setTimeout } = require("timers");
const moment = require("moment");
const { conn } = require("../config/db.config");

const getThepriceDroppingValue = async () => {
  const sql = `SELECT * FROM checkins_hotels_policy WHERE id = 1`;
  const [rows] = await conn.promise().query(sql);
  return rows[0].totalRate;
};

const getThepriceReaddedValue = async () => {
  const sql = `SELECT * FROM checkins_hotels_policy WHERE id = 1`;
  const [rows] = await conn.promise().query(sql);
  return rows[0].checkoutRate;
};

const getThepriceIncreaseValue = async () => {
  const sql = `SELECT * FROM checkins_hotels_policy WHERE id = 1`;
  const [rows] = await conn.promise().query(sql);
  return rows[0].publishedRate;
};

// const priceDroppingValue = 0.88;
// const priceReAddedValue = 0.20;
const priceIncreaseValue = 1.10;

const NODE_ENV="production"
const REACT_APP_URL="https://www.checkins.ai"
const ZENTRUMHUB_API_URL="https://nexus.prod.zentrumhub.com/api/hotel"
const ZENTRUMHUB_API_KEY="e7813f66-2ac8-4f64-a7cd-6ab58e0e5194"
const ZENTRUMHUB_ACCOUNT_ID="chekins-live-account"
const ZENTRUMHUB_LIVE_CHANNEL_ID="ci-live-channel"
const ZENTRUMHUB_RH_CHANNEL_ID="ci-ratehawklive-channel"
const ZENTRUMHUB_WEB_CHANNEL_ID="Ci-weblive-channel"
const ZENTRUMHUB_TB_CHANNEL_ID="ci-tbointllive-channel"
const ZENTRUMHUB_HB_CHANNEL_ID="ci-hbb2clive-channel"
const ZENTRUMHUB_COUNTRY_OF_RESIDENCE="US"
const ZENTRUMHUB_NATIONALITY="US"
const ZENTRUMHUB_CULTURE="en-us"
const TRIP_ADVISOR_API_URL="https://hotelfinderchekins.com"

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

//initial call to the firstcall of the zenrumhuh API to get the token , result key and hotel rates
exports.initalCallOfZentrumhub = async (req, res) => {
  const startDate = req.body.searchParams.startDate;
  const endDate = req.body.searchParams.endDate;
  const occupancies = req.body.searchParams.occupancies;
  const lat = req.body.searchParams.location.coordinates.lat;
  const long = req.body.searchParams.location.coordinates.long;
  const isType = req.body.searchParams.isType;
  const polygonal = req.body.searchParams.boundaries
    ? req.body.searchParams.boundaries.flat().map((coords) => ({
        lat: coords.lat,
        long: coords.long,
      }))
    : null;
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

  const payloadPolygonal = {
    channelId: ZENTRUMHUB_LIVE_CHANNEL_ID,
    segmentId: null,
    currency: currency,
    culture: ZENTRUMHUB_CULTURE,
    checkIn: outputDate,
    checkOut: outputDate2,
    occupancies: occupancies,
    circularRegion: null,
    rectangularRegion: null,
    polygonalRegion: {
      coordinates: polygonal && polygonal[0],
      id: null,
    },
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

    const priceDroppingValue = await getThepriceDroppingValue();
    const priceReAddedValue = await getThepriceReaddedValue();
    const priceIncreaseValue = await getThepriceIncreaseValue();

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

                // Calculate the fee as the difference between the original total rate and the new total rate
                const feeAmount =
                  hotel.rate.totalRate * priceReAddedValue;

                // Create the new rate component object with type "Fee"
                const feeComponent = {
                  amount: feeAmount,
                  description: "Agency Fee",
                  type: "Fee",
                };
                hotel.rate.totalRateOld = hotel.rate.totalRate;
                hotel.rate.baseRateOld = hotel.rate.baseRate;
                // Add the fee component to the rate's otherRateComponents array
                hotel.rate.otherRateComponents.push(feeComponent);

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

              // Calculate the fee as the difference between the original total rate and the new total rate
              const feeAmount =
                hotel.rate.totalRate * priceReAddedValue;

              // Create the new rate component object with type "Fee"
              const feeComponent = {
                amount: feeAmount,
                description: "Agency Fee",
                type: "Fee",
              };
              hotel.rate.totalRateOld = hotel.rate.totalRate;
              hotel.rate.baseRateOld = hotel.rate.baseRate;
              // Add the fee component to the rate's otherRateComponents array
              hotel.rate.otherRateComponents.push(feeComponent);

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
  const isType = req.body.searchParams.isType;
  const polygonal = req.body.searchParams.boundaries
    ? req.body.searchParams.boundaries.flat().map((coords) => ({
        lat: coords.lat,
        long: coords.long,
      }))
    : null;
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
    channelId: ZENTRUMHUB_WEB_CHANNEL_ID,
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

  const payloadPolygonal = {
    channelId: ZENTRUMHUB_WEB_CHANNEL_ID,
    segmentId: null,
    currency: currency,
    culture: ZENTRUMHUB_CULTURE,
    checkIn: outputDate,
    checkOut: outputDate2,
    occupancies: occupancies,
    circularRegion: null,
    rectangularRegion: null,
    polygonalRegion: {
      coordinates: polygonal && polygonal[0],
      id: null,
    },
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

    const priceDroppingValue = await getThepriceDroppingValue();
    const priceReAddedValue = await getThepriceReaddedValue();
    const priceIncreaseValue = await getThepriceIncreaseValue();

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

                // Calculate the fee as the difference between the original total rate and the new total rate
                const feeAmount =
                  hotel.rate.totalRate * priceReAddedValue;

                // Create the new rate component object with type "Fee"
                const feeComponent = {
                  amount: feeAmount,
                  description: "Agency Fee",
                  type: "Fee",
                };
                hotel.rate.totalRateOld = hotel.rate.totalRate;
                hotel.rate.baseRateOld = hotel.rate.baseRate;
                // Add the fee component to the rate's otherRateComponents array
                hotel.rate.otherRateComponents.push(feeComponent);

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

              // Calculate the fee as the difference between the original total rate and the new total rate
              const feeAmount =
                hotel.rate.totalRate * priceReAddedValue;

              // Create the new rate component object with type "Fee"
              const feeComponent = {
                amount: feeAmount,
                description: "Agency Fee",
                type: "Fee",
              };
              hotel.rate.totalRateOld = hotel.rate.totalRate;
              hotel.rate.baseRateOld = hotel.rate.baseRate;
              // Add the fee component to the rate's otherRateComponents array
              hotel.rate.otherRateComponents.push(feeComponent);

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
  const isType = req.body.searchParams.isType;
  const polygonal = req.body.searchParams.boundaries
    ? req.body.searchParams.boundaries.flat().map((coords) => ({
        lat: coords.lat,
        long: coords.long,
      }))
    : null;

  console.log("line 15", lat, long, ipAddress, correlationId);

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

  const payloadPolygonal = {
    channelId: ZENTRUMHUB_LIVE_CHANNEL_ID,
    destinationCountryCode: null,
    filterBy: null,
    culture: ZENTRUMHUB_CULTURE,
    contentFields: ["basic", "masterfacilities"],
    circularRegion: null,
    rectangularRegion: null,
    polygonalRegion: {
      coordinates: polygonal && polygonal[0],
      id: null,
    },
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

      const priceDroppingValue = await getThepriceDroppingValue();
      const priceReAddedValue = await getThepriceReaddedValue();
      const priceIncreaseValue = await getThepriceIncreaseValue();

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

          // Calculate the fee as the difference between the original total rate and the new total rate
          const feeAmount = hotel.rate.totalRate * priceReAddedValue;

          // Create the new rate component object with type "Fee"
          const feeComponent = {
            amount: feeAmount,
            description: "Agency Fee",
            type: "Fee",
          };
          hotel.rate.totalRateOld = hotel.rate.totalRate;
          hotel.rate.baseRateOld = hotel.rate.baseRate;
          // Add the fee component to the rate's otherRateComponents array
          hotel.rate.otherRateComponents.push(feeComponent);

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

  let singleHotelDataCount = 0;

  const singleHotelData = async () => {
    await axios
      .post(
        "https://nexus.prod.zentrumhub.com/api/content/hotelcontent/getHotelContent",
        payload,
        {
          headers: headers,
        }
      )
      .then((response) => {
        console.log(response.data);
        res.status(200).json(response.data);
      })
      .catch((error) => {
        if (singleHotelDataCount < 3) {
          singleHotelDataCount++;
          singleHotelData();
        } else {
          console.log("line 158", error);
          res.status(500).json({
            hotels: [],
            error: "A system error occurred. Try again after some time ",
          });
        }
      });
  };

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
  console.log("ip", req.body);

  //calculate total days to calculate the total room nights rate
  const diffInDays = moment(checkOut).diff(moment(checkIn), "days");

  const outputDate = formatDate(checkIn);
  const outputDate2 = formatDate(checkOut);
  const rooms = occupancies.length;
  const totalRoomNights = calculateTotalRoomNights(checkIn, checkOut, rooms);

  const payload = {
    channelId: ZENTRUMHUB_LIVE_CHANNEL_ID,
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

  let roomAndRatesTokenAPICount = 0;

  const getRoomData = async () => {

    const priceDroppingValue = await getThepriceDroppingValue();
    const priceReAddedValue = await getThepriceReaddedValue();
    const priceIncreaseValue = await getThepriceIncreaseValue();

    console.log("line 145", payload);
    await axios
      .post(
        `${ZENTRUMHUB_API_URL}/${HotelID}/roomsandrates`,
        payload,
        {
          headers,
        }
      )
      .then((response) => {
        const data = response.data;
        console.log("line 151", data);
        if (data?.error) {
          res.status(500).json({
            hotels: [],
            error: data,
          });
        } else if (data === "") {
          res.status(500).json({
            hotels: [],
            error: data,
          });
        }
        data.totalRoomNights = totalRoomNights;
        data.diffInDays = diffInDays;
        data?.hotel?.rates.forEach((rate) => {
          const pricePerRoomPerNight =
            (rate.totalRate / diffInDays) * priceDroppingValue;
          const pricePerRoomPerNightPublish =
            rate.publishedRate / diffInDays;
          // Modify totalRate and publishedRate

          // Calculate the new total rate with the priceDroppingValue factor
          const newTotalRate = rate.totalRate * priceDroppingValue;
          const newBaseRate = rate.baseRate * priceIncreaseValue;

          // Calculate the fee as the difference between the original total rate and the new total rate
          const feeAmount = rate.totalRate * priceReAddedValue;

          // Create the new rate component object with type "Fee"
          const feeComponent = {
            amount: feeAmount,
            description: "Agency Fee",
            type: "Fee",
          };

          rate.totalRateOld = rate.totalRate;
          rate.baseRateOld = rate.baseRate;
          // Add the fee component to the rate's otherRateComponents array
          rate.otherRateComponents.push(feeComponent);

          // Modify totalRate and publishedRate
          rate.totalRate = Math.ceil(newTotalRate);
          rate.baseRate = Math.ceil(newBaseRate);

          rate.dailyTotalRate = Math.ceil(pricePerRoomPerNight);
          rate.dailyPublishedRate = Math.ceil(pricePerRoomPerNightPublish * priceIncreaseValue);
        });

        // res.status(200).json(data);
        return res.status(200).json(data);
      })
      .catch((err) => {
        console.log("line 154", err);
        if (roomAndRatesTokenAPICount < 3) {
          console.log("roomAndRatesTokenAPICount", roomAndRatesTokenAPICount);
          roomAndRatesTokenAPICount++;
          getRoomData();
        } else {
          console.log("line 155", err);
          res.status(500).json({
            hotels: [],
            error:
              "An error occurred while getting the rates for the rooms. Please try again later",
            data: err.data,
          });
        }
      });
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
          console.log(err.data);
        }
      }
    }
  }
};

exports.initRoomAndRatesTokenRateHawk = async (req, res) => {
  const {
    ipAddress,
    correlationId,
    checkIn,
    checkOut,
    occupancies,
    currency,
    id,
  } = req.body;
  console.log("ip", req.body);

  //calculate total days to calculate the total room nights rate
  const diffInDays = moment(checkOut).diff(moment(checkIn), "days");

  const outputDate = formatDate(checkIn);
  const outputDate2 = formatDate(checkOut);
  const rooms = occupancies.length;
  const totalRoomNights = calculateTotalRoomNights(checkIn, checkOut, rooms);

  const payload = {
    channelId: ZENTRUMHUB_WEB_CHANNEL_ID,
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

  let roomAndRatesTokenAPICount = 0;

  const getRoomData = async () => {
    const priceDroppingValue = await getThepriceDroppingValue();
    const priceReAddedValue = await getThepriceReaddedValue();
    const priceIncreaseValue = await getThepriceIncreaseValue();
    console.log("line 145", payload);
    await axios
      .post(
        `${ZENTRUMHUB_API_URL}/${HotelID}/roomsandrates`,
        payload,
        {
          headers,
        }
      )
      .then((response) => {
        const data = response.data;
        console.log("line 151", data);
        if (data?.error) {
          return res.status(500).json({
            hotels: [],
            error: data,
          });
        } else if (data === "") {
          return res.status(500).json({
            hotels: [],
            error: data,
          });
        }
        data.totalRoomNights = totalRoomNights;
        data.diffInDays = diffInDays;
        data?.hotel?.rates.forEach((rate) => {
          const pricePerRoomPerNight =
            (rate.totalRate / diffInDays) * priceDroppingValue;
          const pricePerRoomPerNightPublish =
            rate.publishedRate / diffInDays;
          // Modify totalRate and publishedRate

          // Calculate the new total rate with the priceDroppingValue factor
          const newTotalRate = rate.totalRate * priceDroppingValue;
          const newBaseRate = rate.baseRate * priceIncreaseValue;

          // Calculate the fee as the difference between the original total rate and the new total rate
          const feeAmount = rate.totalRate * priceReAddedValue;

          // Create the new rate component object with type "Fee"
          const feeComponent = {
            amount: feeAmount,
            description: "Agency Fee",
            type: "Fee",
          };
          rate.totalRateOld = rate.totalRate;
          rate.baseRateOld = rate.baseRate;
          // Add the fee component to the rate's otherRateComponents array
          rate.otherRateComponents.push(feeComponent);

          // Modify totalRate and publishedRate
          rate.totalRate = Math.ceil(newTotalRate);
          rate.baseRate = Math.ceil(newBaseRate);

          rate.dailyTotalRate = Math.ceil(pricePerRoomPerNight);
          rate.dailyPublishedRate = Math.ceil(pricePerRoomPerNightPublish * priceIncreaseValue);
        });

        // res.status(200).json(data);
        return res.status(200).json(data);
      })
      .catch((err) => {
        console.log("line 154", err);
        if (roomAndRatesTokenAPICount < 3) {
          console.log("roomAndRatesTokenAPICount", roomAndRatesTokenAPICount);
          roomAndRatesTokenAPICount++;
          getRoomData();
        } else {
          console.log("line 155", err);
          res.status(500).json({
            hotels: [],
            error:
              "An error occurred while getting the rates for the rooms. Please try again later",
            data: err.data,
          });
        }
      });
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
          console.log(err.data);
        }
      }
    }
  }
};

exports.initalCallOfZentrumhubHotelBeds = async (req, res) => {
  const {
    ipAddress,
    correlationId,
    checkIn,
    checkOut,
    occupancies,
    currency,
    id,
  } = req.body;
  console.log("ip", req.body);

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

  let roomAndRatesTokenAPICount = 0;

  const getRoomData = async () => {
    console.log("line 145", payload);
    await axios
      .post(
        `${ZENTRUMHUB_API_URL}/${HotelID}/roomsandrates`,
        payload,
        {
          headers,
        }
      )
      .then((response) => {
        const data = response.data;
        console.log("line 151", data);
        if (data?.error) {
          return res.status(500).json({
            hotels: [],
            error: data,
          });
        } else if (data === "") {
          return res.status(500).json({
            hotels: [],
            error: data,
          });
        } else if (data?.hotel?.rates[0].totalRate > 9900) {
          return res.status(500).json({
            hotels: [],
            error: data,
          });
        }
        data.totalRoomNights = totalRoomNights;
        data.diffInDays = diffInDays;
        data?.hotel?.rates.forEach((rate) => {
          const pricePerRoomPerNight = rate.totalRate / diffInDays;
          const pricePerRoomPerNightPublish = rate.publishedRate / diffInDays;
          // Modify totalRate and publishedRate
          rate.dailyTotalRate = Math.ceil(pricePerRoomPerNight);
          rate.dailyPublishedRate = Math.ceil(pricePerRoomPerNightPublish);
        });

        // res.status(200).json(data);
        return res.status(200).json(data);
      })
      .catch((err) => {
        console.log("line 154", err);
        if (roomAndRatesTokenAPICount < 3) {
          console.log("roomAndRatesTokenAPICount", roomAndRatesTokenAPICount);
          roomAndRatesTokenAPICount++;
          getRoomData();
        } else {
          console.log("line 155", err);
          res.status(500).json({
            hotels: [],
            error:
              "An error occurred while getting the rates for the rooms. Please try again later",
            data: err.data,
          });
        }
      });
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
          console.log(err.data);
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
    checkOut,
    checkIn,
  } = req.body;

  const headers = generateHeaders(ipAddress, correlationId);

  const diffInDays = moment(checkOut).diff(moment(checkIn), "days");

  let priceCheckingRecommendationCount = 0;

  const priceCheckingRecommendation = async () => {
    const priceDroppingValue = await getThepriceDroppingValue();
    const priceReAddedValue = await getThepriceReaddedValue();
    const priceIncreaseValue = await getThepriceIncreaseValue();
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
        data?.hotel?.rates.forEach((rate) => {
          const pricePerRoomPerNight =
            (rate.totalRate / diffInDays) * priceDroppingValue;
          const pricePerRoomPerNightPublish =
            (rate.baseRate / diffInDays) * priceDroppingValue;

         // Calculate the new total rate with the priceDroppingValue factor
          const newTotalRate = rate.totalRate * priceDroppingValue;
          const newBaseRate = rate.baseRate * priceIncreaseValue;

          // Calculate the fee as the difference between the original total rate and the new total rate
          const feeAmount = rate.totalRate * priceReAddedValue;

          // Create the new rate component object with type "Fee"
          const feeComponent = {
            amount: feeAmount,
            description: "Agency Fee",
            type: "Fee",
          };
          rate.totalRateOld = rate.totalRate;
          rate.baseRateOld = rate.baseRate;
          // Add the fee component to the rate's otherRateComponents array
          rate.otherRateComponents.push(feeComponent);

          // Modify totalRate and publishedRate
          rate.totalRate = Math.ceil(newTotalRate);
          rate.baseRate = Math.ceil(newBaseRate);
        });

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

//function for getting both hotel rates and basic content of the hotel
exports.hotelsForChatBot = async (req, res) => {
  const { hotels, startDate, endDate, occupancies, currency } = req.body;

  const correlationId = "1824skjdjuuwu";
  const ipAddress = "192.168.1.1";

  const hotelIds = [];

  const headers = generateHeaders(ipAddress, correlationId);

  const diffInDays = moment(endDate).diff(moment(startDate), "days");

  const outputDate = formatDate(startDate);
  const outputDate2 = formatDate(endDate);
  const rooms = occupancies.length;
  const totalRoomNights = calculateTotalRoomNights(startDate, endDate, rooms);

  try {
    //calling the autosuggestion api for each hotel that chatgpt provided to get the hotel Id
    for (const hotel of hotels) {
      const response = await axios.get(
        "https://autosuggest-v2.us.prod.zentrumhub.com/api/locations/locationcontent/autosuggest",
        {
          params: {
            term: hotel.name,
            size: 50,
          },
        }
      );
      console.log(response.data);
      const locationSuggestions = response.data.locationSuggestions;

      //checking the hotel name and city name and getting the hotel id
      const hotelResults = locationSuggestions.filter(
        (result) =>
          result.type === "Hotel" &&
          result.city.toLowerCase() === hotel.city.toLowerCase()
      );

      //if hotels exsists then push the hotel id to the hotelIds array
      if (hotelResults.length > 0) {
        const hotelID = hotelResults[0].referenceId;

        console.log(`hotelResults[0] is ${hotelResults[0]}`);

        hotelIds.push(hotelID);
      } else {
        continue;
      }
    }

    //payload for the basic hotel api
    const payload = {
      channelId: ZENTRUMHUB_LIVE_CHANNEL_ID,
      destinationCountryCode: null,
      filterBy: null,
      culture: ZENTRUMHUB_CULTURE,
      contentFields: ["basic", "masterfacilities"],
      circularRegion: null,
      rectangularRegion: null,
      polygonalRegion: null,
      multiPolygonalRegion: null,
      hotelIds: hotelIds,
    };

    //payload for the rates api
    const payloadRate = {
      channelId: ZENTRUMHUB_LIVE_CHANNEL_ID,
      segmentId: null,
      currency: currency,
      culture: ZENTRUMHUB_CULTURE,
      checkIn: outputDate,
      checkOut: outputDate2,
      occupancies: occupancies,
      circularRegion: null,
      rectangularRegion: null,
      polygonalRegion: null,
      multiPolygonalRegion: null,
      hotelIds: hotelIds,
      nationality: ZENTRUMHUB_NATIONALITY,
      countryOfResidence: ZENTRUMHUB_COUNTRY_OF_RESIDENCE,
      destinationCountryCode: null,
      filterBy: null,
    };

    //creating the array for the hotel details and rates
    let basicHotel = {
      hotelDetails: [],
      ratesHotels: [],
    };

    //function for getting the basic content of the hotel
    const getAllHotels = async () => {
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
          basicHotel.hotelDetails = response.data;
          // res.json(response.data);
        })
        .catch((error) => {
          for (let i = 0; i < 3; i++) {
            try {
              getAllHotels();
              break;
            } catch (err) {
              if (i === 2) {
                console.log(err.data);
                res.status(500).json({
                  error:
                    "An error occurred while getting data of basic content api after calling it 3 times",
                });
              }
            }
          }
        });
    };

    //function for creating the token for the rates api
    const getToken = async () => {
      // Make the API call to zentrumhub with the same data
      const zentrumhubResponse = await axios.post(
        `${ZENTRUMHUB_API_URL}/availability/init`,
        payloadRate,
        {
          headers: headers,
        }
      );

      if (zentrumhubResponse.data.token) {
        const token = zentrumhubResponse.data.token;
        getAllRatesHotels(token);
      } else {
        res
          .status(500)
          .json({ error: "An error occurred while creating a token" });
      }
    };

    //function for getting the rates of the hotel
    const getAllRatesHotels = async (token, resultkey = null) => {
      await axios
        .get(
          `${
            ZENTRUMHUB_API_URL
          }/availability/async/${token}/results${
            resultkey !== null ? "?nextResultsKey=" + resultkey : ""
          }`,
          { headers: headers }
        )
        .then((response) => {
          const data = response.data;
          if (data.status === "InProgress") {
            if (data.hotels.length === 0) {
              // If there are no hotels in the response, call the API again with the same token
              getAllRatesHotels(token);
            } else {
              data.noofrooms = rooms;
              data.noofdays = diffInDays;
              data.totalRoomNights = totalRoomNights;

              const modifiedData = {
                ...data,
                hotels: data.hotels.map((hotel) => {
                  const pricePerRoomPerNight =
                    hotel.rate.totalRate / diffInDays;
                  const pricePerRoomPerNightPublish =
                    hotel.rate.baseRate / diffInDays;
                  const totaRateCeil = Math.ceil(hotel.rate.totalRate);
                  const pricefortotalrooms = totaRateCeil * rooms;

                  // Modify totalRate and publishedRate
                  return {
                    ...hotel,
                    rate: {
                      ...hotel.rate,
                      dailyTotalRate: Math.ceil(pricePerRoomPerNight),
                      dailyPublishedRate: Math.ceil(
                        pricePerRoomPerNightPublish
                      ),
                      totalTripRate: Math.ceil(pricefortotalrooms),
                    },
                  };
                }),
              };

              // res.status(200).json(data);
              basicHotel.ratesHotels = modifiedData;
              if (
                basicHotel.ratesHotels.hotels.length > 0 &&
                basicHotel.hotelDetails.hotels.length > 0
              ) {
                const firsthotels = basicHotel.hotelDetails.hotels;
                const secondHotels = basicHotel.ratesHotels.hotels;

                const mergedHotels = firsthotels.reduce((acc, staticHotel) => {
                  // Check if location.type is 'hotel' and location.name matches

                  const dynamicHotels = secondHotels.filter(
                    (dynamicHotel) => dynamicHotel.id === staticHotel.id
                  );

                  if (dynamicHotels.length > 0) {
                    const lowestRateHotel = dynamicHotels.reduce(
                      (lowestRate, hotel) => {
                        if (hotel.rate.totalRate < lowestRate.rate.totalRate) {
                          return hotel;
                        }
                        return lowestRate;
                      },
                      dynamicHotels[0]
                    );

                    acc.push({ ...staticHotel, ...lowestRateHotel });
                  }

                  return acc;
                }, []);
                const nextResultsKey = data.nextResultsKey;
                console.log(nextResultsKey);
                getAllRatesHotels(token, nextResultsKey);
              }
            }
          } else if (data.status === "Completed") {
            data.noofrooms = rooms;
            data.noofdays = diffInDays;
            data.totalRoomNights = totalRoomNights;

            const modifiedData = {
              ...data,
              hotels: data.hotels.map((hotel) => {
                const pricePerRoomPerNight = hotel.rate.totalRate / diffInDays;
                const pricePerRoomPerNightPublish =
                  hotel.rate.baseRate / diffInDays;
                const totaRateCeil = Math.ceil(hotel.rate.totalRate);
                const pricefortotalrooms = totaRateCeil * rooms;

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
            basicHotel.ratesHotels = modifiedData;
            if (
              basicHotel.ratesHotels.hotels.length > 0 &&
              basicHotel.hotelDetails.hotels.length > 0
            ) {
              const firsthotels = basicHotel.hotelDetails.hotels;
              const secondHotels = basicHotel.ratesHotels.hotels;

              const mergedHotels = firsthotels.reduce((acc, staticHotel) => {
                // Check if location.type is 'hotel' and location.name matches

                const dynamicHotels = secondHotels.filter(
                  (dynamicHotel) => dynamicHotel.id === staticHotel.id
                );

                if (dynamicHotels.length > 0) {
                  const lowestRateHotel = dynamicHotels.reduce(
                    (lowestRate, hotel) => {
                      if (hotel.rate.totalRate < lowestRate.rate.totalRate) {
                        return hotel;
                      }
                      return lowestRate;
                    },
                    dynamicHotels[0]
                  );

                  acc.push({ ...staticHotel, ...lowestRateHotel });
                }

                return acc;
              }, []);
              res.json({ hotels: mergedHotels });
            }
          }
        })
        .catch((error) => {
          for (let i = 0; i < 3; i++) {
            try {
              setTimeout(() => {
                getAllRatesHotels();
              }, 500);
              break;
            } catch (err) {
              if (i === 2) {
                console.log(err.data);
                res.status(500).json({
                  error:
                    "An error occurred while getting data of rates content api after calling it 3 times",
                });
              }
            }
          }
        });
    };

    //if hotelsIDs is empty then return the error otherwise call the functions
    if (hotelIds.length === 0) {
      res.status(500).json({
        hotels: [],
        error:
          "There is no matching hotels for hotel names that provide by the chatgpt",
        correlationId: correlationId,
      });
    } else {
      try {
        await getAllHotels();
        await getToken();
      } catch (error) {
        res.status(500).json({
          hotels: [],
          error:
            "There is no matching hotels for hotel names that provide by the chatgpt",
          correlationId: correlationId,
        });
      }
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({
      error:
        "There is no matching hotels for hotel names that provide by the chatgpt",
      correlationId: correlationId,
    });
  }
};

//chat gpt that developed with the room rates api and basic hotel api
exports.hotelsForChatBotWithRoom = async (req, res) => {
  const { hotels, startDate, endDate, occupancies, currency } = req.body;

  const correlationId = "1824sk-jdjuuwu";
  const ipAddress = "192.168.1.1";

  const hotelIds = [];

  const headers = generateHeaders(ipAddress, correlationId);

  const diffInDays = moment(endDate).diff(moment(startDate), "days");

  const outputDate = formatDate(startDate);
  const outputDate2 = formatDate(endDate);
  const rooms = occupancies.length;
  const totalRoomNights = calculateTotalRoomNights(startDate, endDate, rooms);

  try {
    //calling the autosuggestion api for each hotel that chatgpt provided to get the hotel Id
    for (const hotel of hotels) {
      const response = await axios.get(
        "https://autosuggest-v2.us.prod.zentrumhub.com/api/locations/locationcontent/autosuggest",
        {
          params: {
            term: hotel.name,
            size: 50,
          },
        }
      );
      console.log(response.data);
      const locationSuggestions = response.data.locationSuggestions;

      //checking the hotel name and city name and getting the hotel id
      const hotelResults = locationSuggestions.filter(
        (result) =>
          result.type === "Hotel" &&
          result.city.toLowerCase() === hotel.city.toLowerCase()
      );

      //if hotels exsists then push the hotel id to the hotelIds array
      if (hotelResults.length > 0) {
        const hotelID = hotelResults[0].referenceId;

        console.log(`hotelResults[0] is ${hotelResults[0]}`);

        hotelIds.push(hotelID);
      } else {
        continue;
      }
    }

    //payload for the basic hotel api
    const payload = {
      channelId: ZENTRUMHUB_LIVE_CHANNEL_ID,
      destinationCountryCode: null,
      filterBy: null,
      culture: ZENTRUMHUB_CULTURE,
      contentFields: ["All"],
      circularRegion: null,
      rectangularRegion: null,
      polygonalRegion: null,
      multiPolygonalRegion: null,
      hotelIds: hotelIds,
    };

    //payload for the rates api
    const payloadRate = {
      channelId: ZENTRUMHUB_LIVE_CHANNEL_ID,
      currency: currency,
      culture: ZENTRUMHUB_CULTURE,
      checkIn: outputDate,
      checkOut: outputDate2,
      occupancies: occupancies,
      nationality: ZENTRUMHUB_NATIONALITY,
      countryOfResidence: ZENTRUMHUB_COUNTRY_OF_RESIDENCE,
    };

    //creating the array for the hotel details and rates
    let basicHotel = {
      hotelDetails: [],
      ratesHotels: [],
    };

    //function for getting the basic content of the hotel
    const getAllHotels = async () => {
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
          basicHotel.hotelDetails = response.data;
          // res.json(response.data);
        })
        .catch((error) => {
          for (let i = 0; i < 3; i++) {
            try {
              getAllHotels();
              break;
            } catch (err) {
              if (i === 2) {
                console.log(err.data);
                res.status(500).json({
                  error:
                    "An error occurred while getting data of basic content api after calling it 3 times",
                });
              }
            }
          }
        });
    };
    //function for creating the token for the rates api

    //function for getting the rates of the hotel
    const getAllRatesHotels = async (id) => {
      try {
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
        console.log("line 151", data);
        data.totalRoomNights = totalRoomNights;
        data.diffInDays = diffInDays;
        data.hotel.rates.forEach((rate) => {
          const pricePerRoomPerNight = rate.totalRate / diffInDays;
          const pricePerRoomPerNightPublish = rate.publishedRate / diffInDays;
          // Modify totalRate and publishedRate
          rate.dailyTotalRate = Math.ceil(pricePerRoomPerNight);
          rate.dailyPublishedRate = Math.ceil(pricePerRoomPerNightPublish);
        });
        return data;
      } catch (error) {
        throw error;
      }
    };

    //if hotelsIDs is empty then return the error otherwise call the functions
    if (hotelIds.length === 0) {
      res.status(500).json({
        hotels: [],
        error:
          "There is no matching hotels for hotel names that provide by the chatgpt",
        correlationId: correlationId,
      });
    } else {
      try {
        await getAllHotels();
        // await getAllRatesHotels();
        const hotelPromises = hotelIds.map(getAllRatesHotels);

        Promise.all(hotelPromises)
          .then((results) => {
            // Do something with the results if needed
            // results will be an array containing the resolved data for each API call
            const validResults = results.filter((result) => result !== null);
            console.log("validResults", validResults);

            if (
              Array.isArray(basicHotel.hotelDetails.hotels) &&
              Array.isArray(validResults)
            ) {
              const firsthotels = basicHotel.hotelDetails.hotels;
              const secondHotels = validResults;

              const mergedHotels = firsthotels.reduce((acc, staticHotel) => {
                // Check if location.type is 'hotel' and location.name matches

                const dynamicHotels = secondHotels.filter(
                  (dynamicHotel) => dynamicHotel.hotel.id === staticHotel.id
                );
                console.log(dynamicHotels);

                if (Array.isArray(dynamicHotels) && dynamicHotels.length > 0) {
                  // const lowestRateHotel = dynamicHotels.reduce(
                  //   (lowestRate, hotel) => {
                  //     if (hotel.rate.totalRate < lowestRate.rate.totalRate) {
                  //       return hotel;
                  //     }
                  //     return lowestRate;
                  //   },
                  //   dynamicHotels[0]
                  // );
                  const rate = dynamicHotels[0].hotel.rates[0];
                  acc.push({
                    ...staticHotel,
                    rate: { ...rate },
                    room: dynamicHotels,
                  });
                }

                return acc;
              }, []);
              res.status(200).json(mergedHotels);
            } else {
              res.status(500).json({
                error:
                  "An error occurred while getting data of rates content api",
              });
            }
          })
          .catch((error) => {
            console.error(error);
            res.status(500).json({
              error:
                "An error occurred while getting data of rates content api",
            });
          });
      } catch (error) {
        res.status(500).json({
          hotels: [],
          error:
            "There is no matching hotels for hotel names that provide by the chatgpt",
          correlationId: correlationId,
        });
      }
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({
      error:
        "There is no matching hotels for hotel names that provide by the chatgpt",
      correlationId: correlationId,
    });
  }
};

//hotel api with the blockmethod for chat gpt
exports.hotelsForChatBotBlockedMethod = async (req, res) => {
  const { hotels, startDate, endDate, occupancies, currency } = req.body;

  const correlationId = "1824skjdjuuwu";
  const ipAddress = "192.168.1.1";

  const hotelIds = [];

  const headers = generateHeaders(ipAddress, correlationId);

  const diffInDays = moment(endDate).diff(moment(startDate), "days");

  const outputDate = formatDate(startDate);
  const outputDate2 = formatDate(endDate);
  const rooms = occupancies.length;
  const totalRoomNights = calculateTotalRoomNights(startDate, endDate, rooms);

  try {
    //calling the autosuggestion api for each hotel that chatgpt provided to get the hotel Id
    for (const hotel of hotels) {
      const response = await axios.get(
        "https://autosuggest-v2.us.prod.zentrumhub.com/api/locations/locationcontent/autosuggest",
        {
          params: {
            term: hotel.name,
            size: 50,
          },
        }
      );
      console.log(response.data);
      const locationSuggestions = response.data.locationSuggestions;

      //checking the hotel name and city name and getting the hotel id
      const hotelResults = locationSuggestions.filter(
        (result) =>
          result.type === "Hotel" &&
          result.city.toLowerCase() === hotel.city.toLowerCase()
      );

      //if hotels exsists then push the hotel id to the hotelIds array
      if (hotelResults.length > 0) {
        const hotelID = hotelResults[0].referenceId;

        console.log(`hotelResults[0] is ${hotelResults[0]}`);

        hotelIds.push(hotelID);
      } else {
        continue;
      }
    }

    //payload for the basic hotel api
    const payload = {
      channelId: ZENTRUMHUB_LIVE_CHANNEL_ID,
      destinationCountryCode: null,
      filterBy: null,
      culture: ZENTRUMHUB_CULTURE,
      contentFields: ["basic", "masterfacilities"],
      circularRegion: null,
      rectangularRegion: null,
      polygonalRegion: null,
      multiPolygonalRegion: null,
      hotelIds: hotelIds,
    };

    //payload for the rates api
    const payloadRate = {
      channelId: ZENTRUMHUB_LIVE_CHANNEL_ID,
      segmentId: null,
      currency: currency,
      culture: ZENTRUMHUB_CULTURE,
      checkIn: outputDate,
      checkOut: outputDate2,
      occupancies: occupancies,
      circularRegion: null,
      rectangularRegion: null,
      polygonalRegion: null,
      multiPolygonalRegion: null,
      hotelIds: hotelIds,
      nationality: ZENTRUMHUB_NATIONALITY,
      countryOfResidence: ZENTRUMHUB_COUNTRY_OF_RESIDENCE,
      destinationCountryCode: null,
      filterBy: null,
    };

    //creating the array for the hotel details and rates
    let basicHotel = {
      hotelDetails: [],
      ratesHotels: [],
    };

    //function for getting the basic content of the hotel
    const getAllHotels = async () => {
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
          basicHotel.hotelDetails = response.data;
          // res.json(response.data);
        })
        .catch((error) => {
          for (let i = 0; i < 3; i++) {
            try {
              getAllHotels();
              break;
            } catch (err) {
              if (i === 2) {
                console.log(err.data);
                res.status(500).json({
                  error:
                    "An error occurred while getting data of basic content api after calling it 3 times",
                });
              }
            }
          }
        });
    };

    //function for creating the token for the rates api
    const getToken = async () => {
      // Make the API call to zentrumhub with the same data
      try {
        const zentrumhubResponse = await axios.post(
          `${ZENTRUMHUB_API_URL}/availability`,
          payloadRate,
          {
            headers: headers,
          }
        );

        const data = zentrumhubResponse.data;

        data.noofrooms = rooms;
        data.noofdays = diffInDays;
        data.totalRoomNights = totalRoomNights;

        const modifiedData = {
          ...data,
          hotels: data.hotels.map((hotel) => {
            const pricePerRoomPerNight = hotel.rate.totalRate / diffInDays;
            const pricePerRoomPerNightPublish =
              hotel.rate.baseRate / diffInDays;
            const totaRateCeil = Math.ceil(hotel.rate.totalRate);
            const pricefortotalrooms = totaRateCeil * rooms;

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
        basicHotel.ratesHotels = modifiedData;
        if (
          basicHotel.ratesHotels.hotels.length > 0 &&
          basicHotel.hotelDetails.hotels.length > 0
        ) {
          const firsthotels = basicHotel.hotelDetails.hotels;
          const secondHotels = basicHotel.ratesHotels.hotels;

          const mergedHotels = firsthotels.reduce((acc, staticHotel) => {
            // Check if location.type is 'hotel' and location.name matches

            const dynamicHotels = secondHotels.filter(
              (dynamicHotel) => dynamicHotel.id === staticHotel.id
            );

            if (dynamicHotels.length > 0) {
              const lowestRateHotel = dynamicHotels.reduce(
                (lowestRate, hotel) => {
                  if (hotel.rate.totalRate < lowestRate.rate.totalRate) {
                    return hotel;
                  }
                  return lowestRate;
                },
                dynamicHotels[0]
              );

              acc.push({ ...staticHotel, ...lowestRateHotel });
            }

            return acc;
          }, []);
          res.json({ hotels: mergedHotels });
        }
      } catch (err) {
        console.log(err);
        res.status(500).json({
          error: "An error occurred while getting the rates for hotels",
        });
      }
    };

    //if hotelsIDs is empty then return the error otherwise call the functions
    if (hotelIds.length === 0) {
      res.status(500).json({
        hotels: [],
        error:
          "There is no matching hotels for hotel names that provide by the chatgpt",
        correlationId: correlationId,
      });
    } else {
      try {
        await getAllHotels();
        await getToken();
      } catch (error) {
        res.status(500).json({
          hotels: [],
          error:
            "There is no matching hotels for hotel names that provide by the chatgpt",
          correlationId: correlationId,
        });
      }
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({
      error:
        "There is no matching hotels for hotel names that provide by the chatgpt",
      correlationId: correlationId,
    });
  }
};

exports.singleHotelDataByName = async (req, res) => {
  const { hotelName, city, ipAddress, correlationId } = req.body;
  const hotelIds = [];

  console.log("hotelName", hotelName, "city", city);

  const headers = generateHeaders(ipAddress, correlationId);
  let getAllHotelsCount = 0;

  const getHotelContent = async (hotelID) => {
    try {
      await axios
        .post(
          "https://nexus.prod.zentrumhub.com/api/content/hotelcontent/getHotelContent",
          {
            channelId: ZENTRUMHUB_LIVE_CHANNEL_ID,
            culture: ZENTRUMHUB_CULTURE,
            includeAllProviders: true,
            hotelIds: [hotelID],
            filterBy: null,
            contentFields: ["All"],
          },
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
            getHotelContent();
          } else {
            res.json(error);
          }
        });
    } catch (error) {
      console.log(error);
      res.status(500).json({
        error:
          "There is no matching hotels for hotel names that provide by the chatgpt",
        correlationId: correlationId,
      });
    }
  };
  const getHotelID = async () => {
    try {
      const response = await axios.get(
        "https://autosuggest-v2.us.prod.zentrumhub.com/api/locations/locationcontent/autosuggest",
        {
          params: {
            term: hotelName,
            size: 150,
          },
        }
      );
      console.log(response.data);
      const locationSuggestions = response.data.locationSuggestions;
      const hotelResults = locationSuggestions.filter(
        (result) =>
          result.type === "Hotel" &&
          result.city.toLowerCase() === city.toLowerCase()
      );
      if (hotelResults.length > 0) {
        const hotelID = hotelResults[0].referenceId;

        console.log(`hotelResults[0] is ${hotelResults[0]}`);

        getHotelContent(hotelID);
      } else {
        res.status(500).json({
          error:
            "There is no matching hotels for hotel names that provide by the city and hotel name",
          correlationId: correlationId,
        });
      }
    } catch (error) {
      console.log(error);
      res.status(500).json({
        error:
          "There is no matching hotels for hotel names that provide by the city and hotel name",
        correlationId: correlationId,
      });
    }
  };

  try {
    await getHotelID();
  } catch (error) {
    console.log(error);
    res.status(500).json({
      error:
        "There is no matching hotels for hotel names that provide by the city and hotel name",
      correlationId: correlationId,
    });
  }
};

exports.initRoomAndRatesTokenByName = async (req, res) => {
  const {
    ipAddress,
    correlationId,
    checkIn,
    checkOut,
    occupancies,
    currency,
    hotelName,
    city,
  } = req.body;

  const headers = generateHeaders(ipAddress, correlationId);

  //calculate total days to calculate the total room nights rate
  const diffInDays = moment(checkOut).diff(moment(checkIn), "days");

  const outputDate = formatDate(checkIn);
  const outputDate2 = formatDate(checkOut);
  const rooms = occupancies.length;
  const totalRoomNights = calculateTotalRoomNights(checkIn, checkOut, rooms);

  const payload = {
    channelId: ZENTRUMHUB_LIVE_CHANNEL_ID,
    currency: currency,
    culture: ZENTRUMHUB_CULTURE,
    checkIn: outputDate,
    checkOut: outputDate2,
    occupancies: occupancies,
    nationality: ZENTRUMHUB_NATIONALITY,
    countryOfResidence: ZENTRUMHUB_COUNTRY_OF_RESIDENCE,
  };

  let roomAndRatesTokenAPICount = 0;

  const getHotelContent = async (hotelID) => {
    const priceDroppingValue = await getThepriceDroppingValue();
    const priceReAddedValue = await getThepriceReaddedValue();
    const priceIncreaseValue = await getThepriceIncreaseValue();
    await axios
      .post(
        `${ZENTRUMHUB_API_URL}/${hotelID}/roomsandrates`,
        payload,
        {
          headers,
        }
      )
      .then((response) => {
        const data = response.data;
        console.log("line 151", data);
        data.totalRoomNights = totalRoomNights;
        data.diffInDays = diffInDays;
        data.hotel.rates.forEach((rate) => {
          const pricePerRoomPerNight =
            (rate.totalRate / diffInDays) * priceDroppingValue;
          const pricePerRoomPerNightPublish =
            rate.publishedRate / diffInDays;
          // Modify totalRate and publishedRate

          // Calculate the new total rate with the priceDroppingValue factor
          const newTotalRate = rate.totalRate * priceDroppingValue;
          const newBaseRate = rate.baseRate * priceIncreaseValue;

          // Calculate the fee as the difference between the original total rate and the new total rate
          const feeAmount = rate.totalRate * priceReAddedValue;

          // Create the new rate component object with type "Fee"
          const feeComponent = {
            amount: feeAmount,
            description: "Agency Fee",
            type: "Fee",
          };

          rate.totalRateOld = rate.totalRate;
          rate.baseRateOld = rate.baseRate;
          // Add the fee component to the rate's otherRateComponents array
          rate.otherRateComponents.push(feeComponent);

          // Modify totalRate and publishedRate
          rate.totalRate = Math.ceil(newTotalRate);
          rate.baseRate = Math.ceil(newBaseRate);

          rate.dailyTotalRate = Math.ceil(pricePerRoomPerNight);
          rate.dailyPublishedRate = Math.ceil(pricePerRoomPerNightPublish);
        });
        res.status(200).json(data);
      })
      .catch((err) => {
        console.log("line 154", err);
        if (roomAndRatesTokenAPICount < 3) {
          console.log("roomAndRatesTokenAPICount", roomAndRatesTokenAPICount);
          roomAndRatesTokenAPICount++;
          getRoomData();
        } else {
          console.log("line 155", err);
          res.status(500).json({
            hotels: [],
            error:
              "An error occurred while getting the rates for the rooms. Please try again later",
            data: err.data,
          });
        }
      });
  };
  const getHotelID = async () => {
    try {
      const response = await axios.get(
        "https://autosuggest-v2.us.prod.zentrumhub.com/api/locations/locationcontent/autosuggest",
        {
          params: {
            term: hotelName,
            size: 150,
          },
        }
      );
      console.log(response.data);
      const locationSuggestions = response.data.locationSuggestions;
      const hotelResults = locationSuggestions.filter(
        (result) =>
          result.type === "Hotel" &&
          result.city.toLowerCase() === city.toLowerCase()
      );
      if (hotelResults.length > 0) {
        const hotelID = hotelResults[0].referenceId;

        console.log(`hotelResults[0] is ${hotelResults[0]}`);

        getHotelContent(hotelID);
      } else {
        res.status(500).json({
          error:
            "There is no matching hotels for hotel names that provide by the city and hotel name",
          correlationId: correlationId,
        });
      }
    } catch (error) {
      console.log(error);
      res.status(500).json({
        error:
          "There is no matching hotels for hotel names that provide by the city and hotel name",
        correlationId: correlationId,
      });
    }
  };

  try {
    await getHotelID();
  } catch (error) {
    console.log(error);
    res.status(500).json({
      error:
        "There is no matching hotels for hotel names that provide by the city and hotel name",
      correlationId: correlationId,
    });
  }
};

//hotel api with the blockmethod for google
exports.hotelsForGoogleBlockedMethod = async (req, res) => {
  let ids = null;
  try {
    const { Query } = req.body; // Destructure the request body
    // console.log("Query", Query);
    // console.log("req.body", req.body);

    const { Checkin, Nights, PropertyList } = Query; // Destructure properties from the Query object

    const correlationId = "googlecorrelationId";
    const ipAddress = "192.168.1.1";

    const hotelIds = PropertyList[0].Property; // Extract hotel IDs from PropertyList
    ids = hotelIds;

    const headers = generateHeaders(ipAddress, correlationId);

    // const diffInDays = Nights; // Use the provided Nights value

    const outputDate = formatDate(Checkin[0]);
    const outputDate2 = formatDate(moment(Checkin[0]).add(Nights, "days")); // Calculate checkOut date

    //payload for the rates api
    const payloadRate = {
      channelId: ZENTRUMHUB_HB_CHANNEL_ID,
      segmentId: null,
      currency: "USD",
      culture: ZENTRUMHUB_CULTURE,
      checkIn: outputDate,
      checkOut: outputDate2,
      occupancies: [
        {
          numOfAdults: 2,
          childAges: [],
        },
      ],
      circularRegion: null,
      rectangularRegion: null,
      polygonalRegion: null,
      multiPolygonalRegion: null,
      hotelIds: hotelIds,
      nationality: ZENTRUMHUB_NATIONALITY,
      countryOfResidence: ZENTRUMHUB_COUNTRY_OF_RESIDENCE,
      destinationCountryCode: null,
      filterBy: null,
    };

    //function for creating the token for the rates api
    const getToken = async () => {
      // Make the API call to zentrumhub with the same data
      try {
        const zentrumhubResponse = await axios.post(
          `${ZENTRUMHUB_API_URL}/availability`,
          payloadRate,
          {
            headers: headers,
          }
        );

        const data = zentrumhubResponse.data;

        if (data.hotels.length === 0) {
          const xmlResults = hotelIds
            .map((hotelId) => {
              return `
          <Result>
            <Property>${hotelId}</Property>
            <Checkin>${outputDate}</Checkin>
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
        } else {
          const xmlResults = hotelIds
            .map((hotelId) => {
              const hotel = data.hotels.find((h) => h.id === hotelId);

              if (hotel) {
                const totalRateCeil = Math.ceil(hotel.rate.totalRate);
                return `
              <Result>
                <Property>${hotel.id}</Property>
                <Checkin>${outputDate}</Checkin>
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
                <Checkin>${outputDate}</Checkin>
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
        }
      } catch (err) {
        console.log(err);
        const xmlResults = hotelIds
          .map((hotelId) => {
            return `
        <Result>
          <Property>${hotelId}</Property>
          <Checkin>${outputDate}</Checkin>
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

    //if hotelsIDs is empty then return the error otherwise call the functions
    if (hotelIds.length === 0) {
      const xmlResults = hotelIds
        .map((hotelId) => {
          return `
      <Result>
        <Property>${hotelId}</Property>
        <Checkin>${outputDate}</Checkin>
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
    } else {
      try {
        await getToken();
      } catch (error) {
        const xmlResults = hotelIds
          .map((hotelId) => {
            return `
        <Result>
          <Property>${hotelId}</Property>
          <Checkin>${outputDate}</Checkin>
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
      <Checkin>${outputDate}</Checkin>
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

exports.hotelsForGoogleBlockedMethodWithRooms = async (req, res) => {
  let ids = null;
  try {
    const { Query } = req.body; // Destructure the request body
    // console.log("Query", Query);
    // console.log("req.body", req.body);

    const { Checkin, Nights, PropertyList } = Query; // Destructure properties from the Query object

    const correlationId = "googlecorrelationId";
    const ipAddress = "192.168.1.1";

    const hotelIds = PropertyList[0].Property; // Extract hotel IDs from PropertyList
    ids = hotelIds;

    const headers = generateHeaders(ipAddress, correlationId);

    // const diffInDays = Nights; // Use the provided Nights value

    const outputDate = formatDate(Checkin[0]);
    const outputDate2 = formatDate(moment(Checkin[0]).add(Nights, "days")); // Calculate checkOut date

    //payload for the rates api
    const payloadRate = {
      channelId: ZENTRUMHUB_HB_CHANNEL_ID,
      currency: "USD",
      culture: ZENTRUMHUB_CULTURE,
      checkIn: outputDate,
      checkOut: outputDate2,
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
        console.log("line 151", data);

        return data;
      } catch (error) {
        throw error;
      }
    };
    //function for creating the token for the rates api

    //if hotelsIDs is empty then return the error otherwise call the functions
    if (hotelIds.length === 0) {
      const xmlResults = hotelIds
        .map((hotelId) => {
          return `
      <Result>
        <Property>${hotelId}</Property>
        <Checkin>${outputDate}</Checkin>
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
    } else {
      try {
        const hotelPromises = hotelIds.map(getAllRatesHotels);
        Promise.all(hotelPromises)
          .then((results) => {
            try {
              const validResults = results.filter((result) => {
                return result !== null && result !== undefined && result !== "";
              });
              console.log("validResults", results);

              const xmlResults = hotelIds
                .map((hotelId) => {
                  const hotel = validResults.find(
                    (h) => h && h?.hotel && h?.hotel?.id === hotelId
                  );

                  if (hotel) {
                    // return res.send(hotel);
                    console.log(hotel);
                    const totalRateCeil = Math.ceil(
                      hotel.hotel.rates[0].totalRate
                    );
                    console.log("totalRateCeil", totalRateCeil);
                    return `
                              <Result>
                                <Property>${hotel.hotel.id}</Property>
                                <Checkin>${outputDate}</Checkin>
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
                          <Checkin>${outputDate}</Checkin>
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
                <Checkin>${outputDate}</Checkin>
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
            // return res.status(200).json(validResults);
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
                <Checkin>${outputDate}</Checkin>
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
        <Checkin>${outputDate}</Checkin>
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
      <Checkin>${outputDate}</Checkin>
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

exports.hotelsForGoogleHintMethod = async (req, res) => {
  const { HintRequest } = req.body; // Destructure the request body
  console.log("Query", HintRequest);
  console.log("req.body", req.body[0]);
  // return res.status(200).json({ message: "success" ,  Hints : Hint});
  // const { Item } = Hint; // Destructure properties from the Query object
  const Item = Hint.Item[0];
  const correlationId = "googlecorrelationId";
  const ipAddress = "192.168.1.1";

  // return res.status(200).json({ message: "success", Hints: Hint });

  const hotelIds = Item.Property; // Extract hotel IDs from PropertyList

  const headers = generateHeaders(ipAddress, correlationId);

  // const diffInDays = Nights; // Use the provided Nights value
  const Nights = parseInt(Item.Stay[0].LengthOfStay[0]);

  const outputDate = formatDate(Item.Stay[0].CheckInDate[0]);
  const outputDate2 = formatDate(
    moment(Item.Stay[0].CheckInDate[0]).add(Nights, "days")
  ); // Calculate checkOut date

  try {
    //payload for the rates api
    const payloadRate = {
      channelId: ZENTRUMHUB_LIVE_CHANNEL_ID,
      segmentId: null,
      currency: "USD",
      culture: ZENTRUMHUB_CULTURE,
      checkIn: outputDate,
      checkOut: outputDate2,
      occupancies: [
        {
          numOfAdults: 2,
          childAges: [],
        },
      ],
      circularRegion: null,
      rectangularRegion: null,
      polygonalRegion: null,
      multiPolygonalRegion: null,
      hotelIds: hotelIds,
      nationality: ZENTRUMHUB_NATIONALITY,
      countryOfResidence: ZENTRUMHUB_COUNTRY_OF_RESIDENCE,
      destinationCountryCode: null,
      filterBy: null,
    };

    //function for creating the token for the rates api
    const getToken = async () => {
      // Make the API call to zentrumhub with the same data
      try {
        const zentrumhubResponse = await axios.post(
          `${ZENTRUMHUB_API_URL}/availability`,
          payloadRate,
          {
            headers: headers,
          }
        );

        const data = zentrumhubResponse.data;

        if (data.hotels.length === 0) {
          const xmlResults = hotelIds.map((hotelId) => {
            return `
          <Result>
            <Property>${hotelId}</Property>
            <Checkin>${outputDate}</Checkin>
            <Nights>${Nights}</Nights>
            <Unavailable>
              <NoVacancy/>
            </Unavailable>
          </Result>`;
          });
          const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
          <Transaction timestamp="${new Date().toISOString()}" id="${correlationId}">
            ${xmlResults}
          </Transaction>`;

          res.set("Content-Type", "application/xml");
          res.status(200).send(xmlResponse);
        } else {
          const xmlResults = hotelIds
            .map((hotelId) => {
              const hotel = data.hotels.find((h) => h.id === hotelId);

              if (hotel) {
                const totalRateCeil = Math.ceil(hotel.rate.totalRate);
                return `
              <Result>
                <Property>${hotel.id}</Property>
                <Checkin>${outputDate}</Checkin>
                <Nights>${Nights}</Nights>
                <Baserate currency="USD">${totalRateCeil.toFixed(2)}</Baserate>
              </Result>`;
              } else {
                return `
              <Result>
                <Property>${hotelId}</Property>
                <Checkin>${outputDate}</Checkin>
                <Nights>${Nights}</Nights>
                <Unavailable>
                  <NoVacancy/>
                </Unavailable>
              </Result>`;
              }
            })
            .join("\n");

          const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
          <Transaction timestamp="${new Date().toISOString()}" id="${correlationId}">
            ${xmlResults}
          </Transaction>`;

          res.set("Content-Type", "application/xml");
          res.status(200).send(xmlResponse);
        }
      } catch (err) {
        console.log(err);
        const xmlResults = hotelIds.map((hotelId) => {
          return `
        <Result>
          <Property>${hotelId}</Property>
          <Checkin>${outputDate}</Checkin>
          <Nights>${Nights}</Nights>
          <Unavailable>
            <NoVacancy/>
          </Unavailable>
        </Result>`;
        });
        const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <Transaction timestamp="${new Date().toISOString()}" id="${correlationId}">
          ${xmlResults}
        </Transaction>`;

        res.set("Content-Type", "application/xml");
        res.status(200).send(xmlResponse);
      }
    };

    //if hotelsIDs is empty then return the error otherwise call the functions
    if (hotelIds.length === 0) {
      const xmlResults = hotelIds.map((hotelId) => {
        return `
      <Result>
        <Property>${hotelId}</Property>
        <Checkin>${outputDate}</Checkin>
        <Nights>${Nights}</Nights>
        <Unavailable>
          <NoVacancy/>
        </Unavailable>
      </Result>`;
      });
      const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Transaction timestamp="${new Date().toISOString()}" id="${correlationId}">
        ${xmlResults}
      </Transaction>`;

      res.set("Content-Type", "application/xml");
      res.status(200).send(xmlResponse);
    } else {
      try {
        await getToken();
      } catch (error) {
        const xmlResults = hotelIds.map((hotelId) => {
          return `
        <Result>
          <Property>${hotelId}</Property>
          <Checkin>${outputDate}</Checkin>
          <Nights>${Nights}</Nights>
          <Unavailable>
            <NoVacancy/>
          </Unavailable>
        </Result>`;
        });
        const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <Transaction timestamp="${new Date().toISOString()}" id="${correlationId}">
          ${xmlResults}
        </Transaction>`;

        res.set("Content-Type", "application/xml");
        res.status(200).send(xmlResponse);
      }
    }
  } catch (error) {
    console.log(error);
    const xmlResults = hotelIds.map((hotelId) => {
      return `
    <Result>
      <Property>${hotelId}</Property>
      <Checkin>${outputDate}</Checkin>
      <Nights>${Nights}</Nights>
      <Unavailable>
        <NoVacancy/>
      </Unavailable>
    </Result>`;
    });
    const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
    <Transaction timestamp="${new Date().toISOString()}" id="${correlationId}">
      ${xmlResults}
    </Transaction>`;

    res.set("Content-Type", "application/xml");
    res.status(200).send(xmlResponse);
  }
};

exports.reviewsForTheHotel = async (req, res) => {
  try {
    const { city, hotelName } = req.body;

    const response = await axios.get(
      `${TRIP_ADVISOR_API_URL}/api/get-locations?hotel=${hotelName}&city=${city}`
    );

    if (response.data.data.length === 0) {
      return res.status(500).json({
        error:
          "There is no matching hotels for hotel names that provide by the city and hotel name",
      });
    }

    const firstResultID = response.data.data[0].location_id;

    try {
      const response = await axios.get(
        `${TRIP_ADVISOR_API_URL}/api/get-reviews/${firstResultID}`
      );

      return res.status(200).json(response.data);
    } catch (err) {
      console.log(err);
      return res.status(500).json({
        error:
          "There is no matching hotels for hotel names that provide by the city and hotel name",
      });
    }
  } catch (err) {
    console.log(err);
    return res.status(500).json({
      error:
        "There is no matching hotels for hotel names that provide by the city and hotel name",
    });
  }
};

exports.reviewsForTheHotelOneCall = async (req, res) => {
  try {
    const { city, hotelName } = req.body;

    const response = await axios.get(
      `https://hotelfinderchekins.com/hotel_reviews?hotel=${hotelName}, ${city}`
    );

    if (response.data.length === 0) {
      return res.status(404).json({
        error:
          "There is no matching hotels for hotel names that provide by the city and hotel name",
        reviews: [],
      });
    }

    return res.status(200).json({ reviews: response.data });
  } catch (err) {
    console.log(err);
    return res.status(500).json({
      error:
        "There is no matching hotels for hotel names that provide by the city and hotel name",
      reviews: [],
    });
  }
};
