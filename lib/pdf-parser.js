import pdfParse from 'pdf-parse';

export async function parsePDF(buffer) {
  return await pdfParse(buffer);
}
