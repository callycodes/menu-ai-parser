const fs = require("fs");
const OpenAI = require("openai");
const { convertPdfToImages } = require("../utils/pdf-to-image"); // You'll need to create this utility
const dotenv = require("dotenv");
const sharp = require("sharp"); // Import sharp
const AWS = require("aws-sdk");

dotenv.config();

const spacesEndpoint = new AWS.Endpoint("ams3.digitaloceanspaces.com"); // Change 'nyc3' to your region
const s3 = new AWS.S3({
  endpoint: spacesEndpoint,
  accessKeyId: process.env.SPACES_ACCESS,
  secretAccessKey: process.env.SPACES_SECRET,
});

const prompt = `Convert the uploaded images of a menu into a JSON structure that defines both set menu courses and a la carte categories, 
if the menu has a clear set menu offer for a set amount of courses for a price (3 courses for £29.95 for example), we should map the included categories to the courses,
however if the menu is purely a la carte, we should list these under categories. A menu may have a set menu and additional a la carte categories.
We should never map the same category to both courses and categories, and a product should not be mapped to both products and options, just one or the other.
  Pay close attention to dishes that may include an optional side, especially if there is no additional charge for these - these should be mapped to modifiers.
  IMPORTANT NOTES:
  If there is a general upgrade option, such as 'Upgrade fries', create a modifier on the respective products/options with the extra charge.
  Always include a calories value if you see a kcal value (or a number near the product), convert this to an integer, this can be for products, options and even modifiers/addons.
  if you see a vegetarian, vegan, gluten free or other allergies icon, tag or the description states it, please mark the product with an allergies value containing any of 'vegan', 'vege', 'gluten-free', 'nuts' etc. 
  If there is a body of text related to a product, include it as the product/option description.
  If there are product add-ons, extras or additinal charges, nest these under a product in a modifier array with the same attributes, the same if it's a set menu option. 
  Important, this is being processed by an API, please only response in JSON as plain text (so I can parse it), no additional text. Structure should be 
  {
    menus: [
      {
        name: "menu name", //menu name, otherwise restaurant name
        description: "", //optional menu description/subtitle
        categories: [
          {
            name: "", // category name, might be Mains or Sides
            products: [
              {
                name: "product name",
                description: "", //product description or related text, ignore if none
                calories: 0, //optional
                price: 0,
                allergies: [""], //dont include if no allergies
                modifiers: [
                  {
                    name: "modifier group name", //'Upgrade fries' or 'Extras'
                    options: [{
                      name: "modifier name", //'Large fries'
                      price: 0, // if there is an extra charge, else ignore
                      calories: 0, //optional
                    }]
                  },
                ],
              },
            ],
          },
        ],
        courses: [
          {
            title: "Mains", //course title, otherwise default to starter, main, desserts
            options: [
              {
                name: "turkey",
                price: 2, //only if there is an additional charge,
                description: "", //product description/related text if it exists
                calories: 0, //optional, dont include if no calories defined
                allergies: [""], //optional, dont include if no allergies
                addons: [
                  {
                    name: "extra gravy",
                    price: 1.99, // optional, only if there is a surcharge/extra charge
                    calories: 0, //optional
                  },
                ],
              },
            ],
          },
        ],
        price: 3, //if it's a set menu, else 0,
      },
    ];
  }`;

const aLaCartePrompt = `You are an expert in processing images of menus and converting them to a specific JSON menu structure - you understand even the most complex menus, paying close attention to calorie values, allergen information, complex modifiers/upgrades. Convert the uploaded images of a menu into the defined JSON structure.
    IMPORTANT NOTES:
    - If there is a general upgrade option on the menu, such as 'Upgrade fries', remember to create the upgrade modifier on the products, paying close attention to extra charges and calories.
    - Always include a calories value if you see a kcal value, note this may be displayed like 123kcal, 123 calories, 123k 123 cal, convert this to an integer, and connect it to the appropriate product or modifier.
    - if you see a vegetarian, vegan, gluten free or other allergies icon, tag or the description states it, please mark the product with an allergies value containing any of 'vegan', 'vege', 'gluten-free', 'nuts' etc. 
    - Try to always include a product description, most products should have these
    - If there are product add-ons, extras or additional charges, nest these under a product in a modifier array. This includes things like 'Add bacon for £1', only include modifier that make logical sense.
    - There may be meal deals on menus, make sure all options are mapped as modifiers under the meal deal product.
    - Be sure to include every single item, modifier, detail, I expect only full responses, no partial examples.
    - When parsing all descriptions and names, make sure to replace " with ' characters to avoid parsing errors
    - Important, this is being processed by an API, please only response in JSON as plain text (so I can parse it), no additional text. Structure should be exactly as follows: 
    {
      menus: [
        {
          name: "menu name", //menu name, otherwise restaurant name
          description: "", //optional menu description/subtitle
          categories: [
            {
              name: "", // category name, might be Mains or Sides
              products: [
                {
                  name: "product name",
                  description: "Crispy fried chicken served with house salad", //product description, if no text then dont include this field
                  calories: 0, //optional, if no calorie definition found then dont include
                  price: 0,
                  allergies: [""], //dont include if no allergies
                  modifiers: [
                    {
                      name: "modifier group name", //'Upgrade fries' or 'Extras'
                      options: [{
                        name: "modifier name", //'Large fries'
                        price: 0, // if there is an extra charge, else dont include
                        calories: 0, //optional, if none defined, dont include this value
                      }]
                    },
                  ],
                },
              ],
            },
          ],
        },
      ];
    }`;

const uploadBufferToSpace = async (buffer, bucketName, destinationFileName) => {
  // Setting up S3 upload parameters
  const params = {
    Bucket: bucketName,
    Key: destinationFileName, // File name you want to save as
    Body: buffer,
    ACL: "public-read", // Access control for the file
  };

  // Uploading files to the bucket
  try {
    const data = await s3.upload(params).promise();
    return data.Location; // This is the file URL
  } catch (err) {
    console.log(err);
    throw err;
  }
};

exports.parseMenu = async (req, res) => {
  try {
    let menuImages;
    if (req.file.mimetype === "application/pdf") {
      console.time("convert_pdf");
      // Convert PDF to images
      menuImages = await convertPdfToImages(req.file.path);
      console.timeEnd("convert_pdf");
    } else {
      // It's already an image
      menuImages = [req.file.path];
    }

    console.time("openai_init");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.timeLog("openai_init");

    console.time("image_read");
    // Process and read images
    const imageContent = await Promise.all(
      menuImages.map(async (image, index) => {
        // Process the image: grayscale and increase contrast
        const processedImageBuffer = await sharp(image)
          .grayscale() // Convert to grayscale
          //.threshold(220) // Apply thresholding; values can be between 0 and 255
          .gamma(3) // Darken mid-tones
          //.normalize() // Stretch contrast
          .withMetadata() // Retain original metadata
          .toFormat("png", { quality: 100 }) // Output as PNG
          .toBuffer();

        console.log("Buffer image now uploading");
        const url = await uploadBufferToSpace(
          processedImageBuffer,
          "orderpay-public",
          `promptathon-cal/${Date.now()}.png`
        );

        // Convert processed image to base64
        //const imageAsBase64 = processedImageBuffer.toString("base64");

        // Define a new file name/path for the processed image
        //const processedImagePath = `./grayscale/processed-${index}.png`;

        // Write the processed image to disk
        // await fs.writeFileSync(processedImagePath, processedImageBuffer);

        console.log(`Uploaded: ${url}`);
        return {
          type: "image_url",
          image_url: url,
          //`data:image/png;base64,${imageAsBase64}`,
        };
      })
    );
    console.timeEnd("image_read");

    const errors = [];
    const responses = await Promise.all(
      imageContent.map(async (image, i) => {
        console.log("Sending GPT request: ", i);
        console.time(`gpt_request_${i}`);
        const response = await openai.chat.completions.create({
          model: "gpt-4-vision-preview",
          messages: [
            {
              role: "system",
              content: aLaCartePrompt,
            },
            {
              role: "user",
              content: [image],
            },
          ],
          max_tokens: 4096,
        });
        console.timeEnd(`gpt_request_${i}`);

        const parsedData = response.choices[0].message.content; // Modify as needed
        const formatted = parsedData
          .replace(/```json\n/g, "") // Remove the beginning ```json\n
          .replace(/```/g, "") // Remove ending ```
          .replaceAll(/\\n/g, "\n") // Replace escaped newline characters with actual newlines
          .replaceAll(/\\/g, ""); // Remove extra backslashes

        await fs.writeFileSync(`./json/${i}.json`, formatted);
        
        try {
          const json = JSON.parse(formatted);
          return json
        } catch (err) {
          console.log('Error when parsing JSON: ', i)
          return undefined
        }
      })
    );

    /**
     * 
     * The plan here was to do a big consolidation call, use AI to merge similar menu categories together but honestly...
     * lets just put them all into a big menu and let the categories be the split factor
    console.log("Sending GPT consolidation request");
    console.time(`gpt_consolidation_request`);
    let response;
    try {
      response = await openai.chat.completions.create({
        model: "gpt-4-1106-preview",
        messages: [
          {
            role: "system",
            content: `Please can you combine the following menu JSON's into a single JSON. If categories belong to what appears the same menu, merge the menu categories into the same array. - Important, this is being processed by an API, please only response in JSON as plain text (so I can parse it), no additional text. ${responses.map(
              (r) => `${JSON.stringify(r)}
            `
            )}`,
          },
        ],
        max_tokens: 4096,
      });
    } catch (err) {
      console.log("Error when consolidating");
      console.log(err);
    }
    console.timeEnd(`gpt_consolidation_request`);

    // Parse the response
    const parsedData = response.choices[0].message.content; // Modify as needed

    // Clean up: delete the uploaded files
    //menuImages.forEach((image) => fs.unlinkSync(image));

    const formatted = parsedData
      .replace(/```json\n/g, "") // Remove the beginning ```json\n
      .replace(/```/g, "") // Remove ending ```
      .replaceAll(/\\n/g, "\n") // Replace escaped newline characters with actual newlines
      .replaceAll(/\\/g, ""); // Remove extra backslashes

    console.log(formatted);
    **/

    const allCategories = responses.flatMap(obj => obj.menus.flatMap(menu => menu.categories));

    res.json({ success: true, data: { name: responses[0].menus[0].name, categories: allCategories } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
