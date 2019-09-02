import fs from "fs";
import { promisify } from "util";
import sharp from "sharp";
import PDFDocument from "pdfkit";
import PDF2Pic from "pdf2pic";
import child_process from "child_process";
import inquirer from "inquirer";
import del from "del";
import _cliProgress from "cli-progress";
const _colors = require("colors");

const docPDF = new PDFDocument({ autoFirstPage: false }); // dont create a empty first page
const readdirAsync = promisify(fs.readdir); // promisify node readdir
const exec = promisify(child_process.exec); // promisify exec
const filesFolder = `${__dirname}/files`;
const croppedFolder = `${__dirname}/files/tmp/cropped`;
const tmpFolder = `${__dirname}/files/tmp`;
const IMG_WIDTH = 5308;
const IMG_HEIGHT = 4011;
const REGEX_PAGES = /(\d{1,2}-+\d{1,2})/;
let answersData = {}; // will contain all the answers from inquirer

// use sharp to crop image
// side can be left or right
async function cropImage(
  filePath,
  fileName,
  side,
  cropPNGsBar,
  currentFileIndex
) {
  let outputImage = `${croppedFolder}/${fileName}.png`;
  await sharp(filePath)
    .extract({
      width: IMG_WIDTH / 2,
      height: IMG_HEIGHT,
      left: side === "left" ? 0 : IMG_WIDTH / 2,
      top: 0
    })
    .toFile(outputImage)
    .then(data => {
      // console.log(`Cropped to ${side} and saved as ${fileName}.png`);
      cropPNGsBar.update(currentFileIndex + 1);
    })
    .catch(err => {
      console.log("An error occured", err);
    });
}

//create Cropped PNG's
async function createCroppedPNGs() {
  const cropPNGsBar = new _cliProgress.SingleBar({
    format: `Cropping PNGs | ${_colors.yellow(
      "{bar}"
    )} | {percentage}% || {value} of {total} pngs`
  });
  await readdirAsync(tmpFolder).then(async files => {
    cropPNGsBar.start(files.length, 0);
    for (const file of files) {
      //check if is a PNG
      if (file.includes(".png")) {
        //save file path
        const filePath = `${tmpFolder}/${file}`;
        //extract page numbers from filename
        const filePages = file.match(REGEX_PAGES).slice(1);
        //split the numbers on a array
        const fileSplitNumbers = filePages[0].split("-");
        //assign to the left side a even number from the given array
        //add a lead 0 if needed
        const fileLeftNumber =
          fileSplitNumbers[0] % 2 == 0
            ? fileSplitNumbers[0].padStart(2, "0")
            : fileSplitNumbers[1].padStart(2, "0");
        //assign to the right side a odd number from the given array
        //add a lead 0 if needed
        const fileRightNumber =
          Math.abs(fileSplitNumbers[0] % 2) == 1
            ? fileSplitNumbers[0].padStart(2, "0")
            : fileSplitNumbers[1].padStart(2, "0");

        //check if cropped folder exists or not
        try {
          if (!fs.existsSync(croppedFolder)) {
            fs.mkdirSync(croppedFolder);
          }
        } catch (err) {
          console.error(err);
        }

        //get index of current file being processed
        const currentFileIndex = files.indexOf(file);

        //crop pngs
        await cropImage(
          filePath,
          fileLeftNumber,
          "left",
          cropPNGsBar,
          currentFileIndex
        );
        await cropImage(
          filePath,
          fileRightNumber,
          "right",
          cropPNGsBar,
          currentFileIndex
        );
      }
    }
  });
  cropPNGsBar.stop();
}

//Write output to single PDF
async function createPDF() {
  //create pdf write stream
  const writeStream = fs.createWriteStream(
    `${filesFolder}/${answersData.title}.pdf`
  );
  docPDF.pipe(writeStream);
  //add the images into the pdf
  await readdirAsync(croppedFolder).then(async files => {
    const pngFiles = files.filter(file => file.includes("png"));
    for (const file of pngFiles) {
      const image = docPDF.openImage(`${croppedFolder}/${file}`);
      docPDF.addPage({ size: [image.width, image.height] });
      docPDF.image(image, 0, 0);
    }
  });
  //finish
  docPDF.end();
  await writeStream.on("finish", () => {
    console.log("PDF Generated!", "\n");
  });
}

//Create PNGs from PDF
async function createPNGsFromPDF() {
  const createPNGsBar = new _cliProgress.SingleBar({
    format: `Creating PNGs from PDFs | ${_colors.yellow(
      "{bar}"
    )} | {percentage}% || {value} of {total} pdfs`
  });
  await readdirAsync(tmpFolder).then(async files => {
    createPNGsBar.start(files.length, 0);
    for (const file of files) {
      const newFileName = file.replace(".pdf", "");
      const pdf2pic = new PDF2Pic({
        density: 300, // output pixels per inch
        savename: newFileName,
        savedir: tmpFolder, // output file location
        format: "png", // output file format
        size: `${IMG_WIDTH}x${IMG_HEIGHT}`
      });

      file.includes("pdf") &&
        (await pdf2pic.convert(`${tmpFolder}/${file}`).then(() => {
          //fixes a bug from pdf2pic
          fs.rename(
            `${tmpFolder}/${newFileName}_1.png`,
            `${tmpFolder}/${newFileName}.png`,
            err => {
              if (err) throw err;
            }
          );
          createPNGsBar.update(files.indexOf(file) + 1);
        }));
    }
  });
  createPNGsBar.stop();
}

//create Temporary folder for all file manipulation
async function createTmpFolder() {
  return fs.mkdir(tmpFolder, { recursive: true }, err => {
    if (err) throw err;
    console.log("Created temp folder", "\n");
  });
}

//delete Temporary folder for all file manipulation
async function delTmpFolder() {
  try {
    if (fs.existsSync(tmpFolder)) {
      console.log("Deleting Temp Folder...", "\n");
      await del([tmpFolder]);
    }
  } catch (err) {
    console.error(err);
  }
}

//rename original files or folders and remove spaces
async function renameFilesFolders() {
  await readdirAsync(filesFolder).then(async files => {
    for (const file of files) {
      fs.rename(
        `${filesFolder}/${file}`,
        `${filesFolder}/${file.split(" ").join("-")}`,
        err => {
          if (err) throw err;
        }
      );
    }
  });
}

//unzip / unrar archives to pdfs
async function extractArchives(data) {
  const { stdout, stderr } = await exec(
    `unrar e ${filesFolder}/${data.extract} ${tmpFolder}`
  );

  if (stderr) {
    console.error(`error: ${stderr}`);
  }
  console.log(`${stdout}`);
}

//copy pdf files from folder
async function copyPDFFilesFromFolder(data) {
  const { stdout, stderr } = await exec(
    `cp -R ${filesFolder}/${data.extract}/. ${tmpFolder}`
  );

  if (stderr) {
    console.error(`error: ${stderr}`);
  }
  console.log(`Finished copying pdfs into files folder. ${stdout}`);
}

//prompt user for choices
async function promptUser() {
  //save archives and other folders into arrays
  let archivesChoices;
  let foldersChoices;
  let extractChoices;
  await readdirAsync(filesFolder, { withFileTypes: true }).then(async files => {
    archivesChoices = [
      ...files.filter(
        file =>
          (file.isFile() && file.name.includes(".rar")) ||
          file.name.includes(".zip")
      )
    ];
    foldersChoices = [
      ...files.filter(file => file.isDirectory()).map(dirent => dirent.name)
    ];
    extractChoices = [...archivesChoices, ...foldersChoices];
  });

  //prompt the first question
  await inquirer
    .prompt([
      {
        type: "rawlist",
        message: "Create a VR PDF from?",
        name: "extract",
        choices: extractChoices
      }
    ])
    .then(async answers => {
      Object.assign(answersData, answers);
      //quickly check if we selected a folder or a archive (zip / rar)
      let isArchive;
      isArchive =
        answersData.extract.includes(".rar") ||
        answersData.extract.includes(".zip");
      answersData["isArchive"] = isArchive;

      //add a title
      await inquirer
        .prompt([
          {
            type: "input",
            message: "What should be the title of the PDF?",
            name: "title"
          }
        ])
        .then(async answers => Object.assign(answersData, answers));
    });
}

//start
async function start() {
  await renameFilesFolders();
  await delTmpFolder();
  await promptUser();
  await createTmpFolder();
  answersData.isArchive
    ? await extractArchives(answersData)
    : await copyPDFFilesFromFolder(answersData);
  await createPNGsFromPDF();
  await createCroppedPNGs();
  await createPDF();
  await delTmpFolder();
}

start();
