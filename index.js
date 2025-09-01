const express = require("express");
const app = express();
const port = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("hello from Quantumedge-Software-Backend");
});

app.listen(port, () => {
  console.log(`server running from http://localhost:${port}`);
});
