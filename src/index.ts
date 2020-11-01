import fs from 'fs';
import { resolve as pathResolve } from 'path';
import { exec, spawn } from 'child_process';
import cheerio from 'cheerio';
import HTMLtoJSX from 'htmltojsx';
import prettier from 'prettier';

const main = async () => {
  if (process.argv.length <= 3) {
    console.log(
      'Syntax : webflow-to-gatsby <WEBFLOW UNZIPPED FOLDER> <GATSBY PROJECT NAME>'
    );
    process.exit();
  }
  const [,,webflowInputFolderPath, gatsbyProjectName] = process.argv;
  const webflowFolderPath = pathResolve(process.cwd(), webflowInputFolderPath);

  const returnCode = await createGatsbyProject(gatsbyProjectName);
   if (returnCode !== 0) {
     process.exit();
  }

  await transferWebflowFiles(webflowFolderPath, gatsbyProjectName);

  await renameImages(gatsbyProjectName);
  convertHtmlFiles(webflowFolderPath, gatsbyProjectName);
};

const createGatsbyProject = (projectName : string) => new Promise(resolve => {
    const gatsbyProjectCreation = spawn('gatsby', [
      'new',
      projectName,
      'https://github.com/gatsbyjs/gatsby-starter-hello-world'
    ]);

    gatsbyProjectCreation.stdout.on('data', data => {
      console.log(`${data}`);
    });

    gatsbyProjectCreation.stderr.on('data', data => {
      console.log(`${data}`);
    });

    gatsbyProjectCreation.on('error', error => {
      console.log(`${error.message}`);
    });
    gatsbyProjectCreation.on('close', code => {
      resolve(code);
    });
  })

const transferWebflowFiles = (webflowFolderPath :string, gatsbyProjectName :string) => {
  const cmd = `cp -r ${webflowFolderPath}/css ${webflowFolderPath}/fonts ${webflowFolderPath}/images ./${gatsbyProjectName}/src/`;
  return new Promise((resolve) => {
    exec(cmd, (error, stdout, stderr) => {
        if (error) {
          console.log(
            `Error when copying folders to gatsby project: ${error.message}`
          );
        }
        console.log('Copied resources.');
        resolve(stdout ? stdout : stderr);
      }
    );
  });
}

const renameImages = (gatsbyProjectName : string) => {
  const gatsbyProjectSubPath = gatsbyProjectName + "/src/images"
  const gatsbyImageFolderName = pathResolve(process.cwd(), gatsbyProjectSubPath);
  return new Promise(resolve => {
    fs.readdir(gatsbyImageFolderName, (err, files) => {
      files.forEach(file => {
        const newFileName = getCorrectFileName(file);

        const cmd = `mv ${gatsbyImageFolderName}/${file} ${gatsbyImageFolderName}/${newFileName}`;

        exec(cmd);
      })
      resolve(files ? "" : err);
    })
  })
}


const getCorrectedPathName = (originalPath : string) =>{
  const originalName = originalPath.replace("images/", "");
  return "images/" + getCorrectFileName(originalName);
}

const getCorrectFileName=(originalName : string) =>{
  const [fileName, fileExtension] = originalName.split(".");
  return fixName(fileName) + '.' + fileExtension;
}

const fixName=(originalName : string)=> originalName.replace(/^[^a-zA-Z_]+|[^a-zA-Z_0-9]+/g, "")

const convertHtmlFiles = (webflowFolderPath : string, gatsbyProjectName: string)=> {
  fs.readdirSync(webflowFolderPath)
    .filter(file => /.html$/.test(file))
    .forEach(file => {
      injectJS(file, webflowFolderPath, gatsbyProjectName);
  })
}

const injectJS = (htmlFilePath : string, webflowFolderPath: string, gatsbyProjectName: string) =>
{
  const htmlFileName = htmlFilePath.split(".")[0];
  const { imageImports, imageVariables, html } = extractImageFiles(
    `${webflowFolderPath}/${htmlFilePath}`
  );
  const output = convertHtmlToJsx(html);
  let formattedJsx = output
    .replace(/(\r\n|\n|\r)/gm, '')
    .split('return (')[1]
    .split(');')[0]
    .replace(/ +(?= )/g, '')
    .split('{/* [if lte IE 9]><![endif] */}')
    .join('');
  formattedJsx = prettier.format(formattedJsx, { parser: 'html' });
  imageVariables.forEach(
    src =>
      (formattedJsx = formattedJsx.replace(
        new RegExp(`src="${src}"`, 'gm'),
        `src={${src}}`
      ))
  );

  const stream = fs.createWriteStream(
    `./${gatsbyProjectName}/src/pages/${htmlFileName}.js`
  );
  stream.once('open', () => {
    stream.write('import React from "react"\n');
    stream.write(
      `import '../css/normalize.css'\nimport '../css/webflow.css'\nimport '../css/${
        webflowFolderPath.split('/')[webflowFolderPath.split('/').length - 1]
      }.css'\n`
    );
    imageImports.forEach(imageImport => stream.write(imageImport + '\n'));
    stream.write('export default () => (\n');
    stream.write('<div className="body">');
    stream.write(formattedJsx);
    stream.write('</div>');
    stream.write(')');
    stream.end();
  });
};

const extractImageFiles = (htmlFilePath: string) => {
  const imageImports = [];
  const imageVariables = [];
  const memo = [];
  const $ = cheerio.load(fs.readFileSync(htmlFilePath, 'utf-8'));
  $('img').each(function() {
    const oldsrc = $(this).attr('src');
    const newsrc = getCorrectedPathName(oldsrc);

    const srcVarName = newsrc.split('.')[0].replace("images/", "");
    if (!memo.includes(srcVarName)) {
      imageImports.push(`import ${srcVarName} from "../${newsrc}"`);
      imageVariables.push(srcVarName);
      memo.push(srcVarName);
    }
    $(this).attr('src', srcVarName);
    $(this).attr('srcset', '');
  });
  return {
    html: $.html(),
    imageImports,
    imageVariables
  };
};

const convertHtmlToJsx = (html: string) => {
  const converter = new HTMLtoJSX({
    createClass: true,
    outputClassName: 'AwesomeComponent'
  });

  return converter.convert(html.split('</head>')[1]);
};

main().then();
