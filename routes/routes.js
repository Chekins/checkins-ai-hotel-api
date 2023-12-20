const express = require("express");

const {
  initalCallOfZentrumhub,
  basicHotelContent,
  nextAsyncHotelData,
  singleHotelData,
  initalCallOfZentrumhubRateHawk,
  initRoomAndRatesToken,
  priceCheckingRecommendation,
  roomBookingZentrumhub,
  hotelsForGoogleBlockedMethodWithRooms,
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
router.post("/api/v1/rates/individualHotel/roomAndRates/availability", priceCheckingRecommendation);
router.post("/api/v1/hotel/room/book", roomBookingZentrumhub);

router.post("/api/v1/google/hotels/query",hotelsForGoogleBlockedMethodWithRooms );

module.exports = {
  routes: router,
};
