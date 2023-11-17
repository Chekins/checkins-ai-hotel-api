const express = require("express");

const {
  initalCallOfZentrumhub,
  basicHotelContent,
  nextAsyncHotelData,
  singleHotelData,
  initRoomAndRatesToken,
  priceCheckingRecommendation,
  roomBookingZentrumhub,
  singleHotelDataByName,
  initRoomAndRatesTokenByName,
  hotelsForChatBot,
  hotelsForChatBotWithRoom,
  hotelsForChatBotBlockedMethod,
  hotelsForGoogleBlockedMethod,
  hotelsForGoogleBlockedMethodWithRooms,
  initalCallOfZentrumhubRateHawk,
  initRoomAndRatesTokenRateHawk,
  initalCallOfZentrumhubHotelBeds,
  reviewsForTheHotel,
  reviewsForTheHotelOneCall
} = require("../controllers/hotelapiRoutes.controller");

const router = express.Router();

//router to handle root path that returns a simple message
router.get("/", (req, res) => {
  res.send("Checkins AI Hotel API is running");
});

//routers for hotel api
router.post("/api/v1/hotels/availability", initalCallOfZentrumhub);
//RateHawk Routes
router.post("/api/v1/hotels/availability/rh", initalCallOfZentrumhubRateHawk);
router.post(
  "/api/v1/hotels/content/hotelcontent/getHotelContent",
  basicHotelContent
);
router.post("/api/v1/hotels/availability/async/:token/:resultkey", nextAsyncHotelData);
router.post("/api/v1/content/individualHotel/getHotelContent", singleHotelData);
router.post("/api/v1/rates/individualHotel/roomAndRates/availability/init", initRoomAndRatesToken);
router.post("/api/v1/rates/individualHotel/roomAndRates/availability/init/rh", initRoomAndRatesTokenRateHawk);
router.post("/api/v1/rates/individualHotel/roomAndRates/availability/init/hb", initalCallOfZentrumhubHotelBeds);
router.post("/api/v1/rates/individualHotel/roomAndRates/availability", priceCheckingRecommendation);
router.post("/api/v1/hotel/room/book", roomBookingZentrumhub);

//routes to get hotel and room details by hotel name and city name
router.post("/api/v1/content/individualHotel/getHotelContent/ByName", singleHotelDataByName);
router.post("/api/v1/rates/individualHotel/roomAndRates/availability/init/ByName", initRoomAndRatesTokenByName);


//routes to chat bot
router.post("/api/v1/chatbot/hotels",hotelsForChatBot );
router.post("/api/v1/chatbot/hotels/block",hotelsForChatBotBlockedMethod );
router.post("/api/v2/chatbot/hotels",hotelsForChatBotWithRoom );


//routes for the google 
router.post("/api/v1/google/hotels/query",hotelsForGoogleBlockedMethod );
router.post("/api/v1/google/hotels/hint",hotelsForGoogleBlockedMethod );
// router.get("/api/v1/google/hotels/block",hotelsForGoogleBlockedMethod );

//route for the review API
router.post("/api/v1/reviews",reviewsForTheHotel);
router.post("/api/v1/reviews/onecall",reviewsForTheHotelOneCall);


module.exports = {
  routes: router,
};
