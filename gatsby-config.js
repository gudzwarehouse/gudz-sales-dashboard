// Make .env.development / .env.production available to Gatsby Functions.
require("dotenv").config({
  path: `.env.${process.env.NODE_ENV || "development"}`,
})

/**
 * @type {import('gatsby').GatsbyConfig}
 */
module.exports = {
  siteMetadata: {
    siteUrl: `https://www.yourdomain.tld`,
  },
  plugins: [],
}
