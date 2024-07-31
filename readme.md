# What does this do
Express.js app with a single upload route, pass in a PDF (can be multipage)/image of a menu, will format and output in a generic menu json structure. Uses OpenAI API, some light image manipulation (for better parsing by Vision GPT)

# Examples
View json folder for example outputs

# Run it
## Install Packages
npm install fs openai dotenv express multer

## Start app
npm run start

## Hit endpoint
Send a POST request with your menu file, receive JSON response
