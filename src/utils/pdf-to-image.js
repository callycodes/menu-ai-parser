const pdf2image = require("pdf2image");
const fs = require("fs");
const { fromPath } = require("pdf2pic");


async function convertPdfToImages(pdfPath) {
  try {
    const options = {
        density: 100,
        saveFilename: pdfPath.replace('uploads/', ''),
        savePath: "./converted",
        format: "png",
        width: 3000,
        preserveAspectRatio: true,
        height: 2400
      };


    console.log(`Converting PDF at path: ${pdfPath}`);

    const images = await fromPath(pdfPath, options).bulk(-1)
    console.log(`Converted images: `, images);

    return images.map((image) => image.path);
  } catch (err) {
    console.error(`Error converting PDF: ${err.message}`);
    throw err; // Re-throw the error to be handled by the caller
  }
}

module.exports = { convertPdfToImages };
