/* ***********************************************************************
 * ADOBE CONFIDENTIAL
 * ___________________
 *
 * Copyright 2024 Adobe
 * All Rights Reserved.
 *
 * NOTICE: All information contained herein is, and remains
 * the property of Adobe and its suppliers, if any. The intellectual
 * and technical concepts contained herein are proprietary to Adobe
 * and its suppliers and are protected by all applicable intellectual
 * property laws, including trade secret and copyright laws.
 * Dissemination of this information or reproduction of this material
 * is strictly forbidden unless prior written permission is obtained
 * from Adobe.
 ************************************************************************* */

const fetch = require('node-fetch-commonjs');
const msal = require('@azure/msal-node');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;

require('dotenv').config();

const SHAREPOINT_CLIENT_ID = process.env.SHAREPOINT_CLIENT_ID;
const SHAREPOINT_TENANT_ID = process.env.SHAREPOINT_TENANT_ID;
const SHAREPOINT_CLIENT_SECRET = process.env.SHAREPOINT_CLIENT_SECRET;
const SHAREPOINT_DRIVE_ID = process.env.SHAREPOINT_DRIVE_ID;
const EDS_ADMIN_KEY = process.env.EDS_ADMIN_KEY;
const CONSUMER = process.env.CONSUMER;
const PREVIEW_INDEX_FILE = process.env.PREVIEW_INDEX_FILE;

const PREVIEW_BASE_URL = `https://main--${CONSUMER}--adobecom.hlx.page`;
const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const SHEET_RAW_INDEX = 'raw_index';
const TABLE_NAME = 'Table1';
let accessToken;
let sessionId;

const decodeToObject = (base64String) => {
  try {
    return JSON.parse(Buffer.from(base64String, 'base64').toString());
  } catch (err) {
    return {};
  }
};

const isTokenExpired = (token) => {
  const tokenParts = token.split('.');
  if (tokenParts.length === 3) {
    const data = decodeToObject(tokenParts[1]);
    if (data && data.exp) {
      return Math.floor(Date.now() / 1000) > data.exp - 10;
    }
  }
  return true;
};

const getAccessToken = async () => {
  if (!accessToken || isTokenExpired(accessToken)) {
    console.log('fetching access token...')
    const authConfig = {
      auth: {
        clientId: SHAREPOINT_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${SHAREPOINT_TENANT_ID}`,
        clientSecret: encodeURIComponent(SHAREPOINT_CLIENT_SECRET)
      }
    }
    const authClient = new msal.ConfidentialClientApplication(authConfig);
    const request = {
      scopes: ['https://graph.microsoft.com/.default']
    };
    const tokens = await authClient.acquireTokenByClientCredential(request);
    accessToken = tokens.accessToken;
    console.log('token fetched.');
  }
  return accessToken;
}

const getResourceIndexData = async (path) => {
  console.log(new Date().toString() + ', path: ' + path);
  const url = `${PREVIEW_BASE_URL}${path}`;
  const response = await fetch(url, {
    headers: {...edsAdminHeaders(), 'Content-Type': 'application/json'}
  });
  if (response?.status !== 200) {
    console.log('Failed to fetch card: ' + url);
    return [];
  }
  const cardHTML = await response.text();
  const document = new JSDOM(cardHTML).window.document;
  const merchCard = document.querySelector('main div.merch-card');
  if (!merchCard) {
    console.log('Merch card not found in the dom: ' + path);
    return [];
  }
  // lastModified and publicationDate are not parsed for preview index since this data is irrelevant
  // robots should be ignored
  const title = document.querySelector('head > meta[property="og:title"]')?.content || '',
    cardContent = merchCard.outerHTML,
    lastModified = '',
    cardClasses = JSON.stringify(Object.values(merchCard.classList)),
    robots =  '',
    tags = document.querySelector('head > meta[property="article:tag"]')?.content || '',
    publicationDate = '';

  return [
    path,
    title,
    cardContent,
    lastModified,
    cardClasses,
    robots,
    tags,
    publicationDate
  ]
}

const sharepointHeaders = async () => ({
  'Authorization': `Bearer ${await getAccessToken()}`,
  'User-Agent': 'NONISV|Adobe|PreviewIndex/0.0.1'
});

const sharepointHeadersWithSession = async () => ({
  'Authorization': `Bearer ${await getAccessToken()}`,
  'User-Agent': 'NONISV|Adobe|PreviewIndex/0.0.1',
  'workbook-session-id': sessionId,
});

const edsAdminHeaders = () => ({
  'Authorization': `token ${EDS_ADMIN_KEY}`,
  'User-Agent': 'NONISV|Adobe|PreviewIndex/0.0.1'
});

const getItemId = async (indexPath) => {
  const url = `${GRAPH_BASE_URL}/drives/${SHAREPOINT_DRIVE_ID}/root:/${indexPath}`;
  console.log(`Get item id: ${url}`);
  const response = await fetch(url, {
    headers: await sharepointHeaders(),
  });
  if (response) {
    console.log(`Check if document exists: ${response.status} - ${response.statusText}`);
    if (response.status === 200) {
      const jsonResponse = await response.json();
      return jsonResponse.id;
    }
  }
  return null;
};

const validateConfig = () => {
  const config = {
    SHAREPOINT_CLIENT_ID: SHAREPOINT_CLIENT_ID,
    SHAREPOINT_TENANT_ID: SHAREPOINT_TENANT_ID,
    SHAREPOINT_CLIENT_SECRET: SHAREPOINT_CLIENT_SECRET,
    SHAREPOINT_DRIVE_ID: SHAREPOINT_DRIVE_ID,
    EDS_ADMIN_KEY: EDS_ADMIN_KEY,
    CONSUMER: CONSUMER,
    PREVIEW_INDEX_FILE: PREVIEW_INDEX_FILE,
  };
  let valid = true;
  Object.entries(config).forEach(([key, value]) => {
    if (!value) {
      console.error(`ERROR: Config item ${key} is empty.`);
      valid = false;
    }
  });
  if (valid) {
    console.log('config is valid')
  }
  return valid;
}

const fetchSessionId = async (itemId) => {
  const createSessionUrl = `${GRAPH_BASE_URL}/drives/${SHAREPOINT_DRIVE_ID}/items/${itemId}/workbook/createSession`;
  const csResponse = await fetch(createSessionUrl, {
    method: 'POST',
    headers: await sharepointHeaders(),
    body: JSON.stringify({
      persistChanges: false
    }),
  });

  if (csResponse?.ok) {
    console.log(`Session created: ${csResponse.status} - ${csResponse.statusText}`);
    const csData = await csResponse.json();
    sessionId = csData.id;
    return true
  } else {
    console.log(`Failed to create session: ${csResponse.status} - ${csResponse.statusText}`);
    return false;
  }
}

const respond = (response, action) => {
  if (response?.ok) {
    console.log(`Action \"${action}\" successful : ${response.status} - ${response.statusText}`);
    return true;
  }

  console.log(`Action \"${action}\" failed: ${response.status} - ${response.statusText}`);
  return false;
}

const clearFilter = async (itemId) => {
  const clearFilterUrl = `${GRAPH_BASE_URL}/drives/${SHAREPOINT_DRIVE_ID}/items/${itemId}/workbook/worksheets/${SHEET_RAW_INDEX}/tables/${TABLE_NAME}/columns/8/filter/clear`;
  const response = await fetch(clearFilterUrl, {
    method: 'POST',
    headers: await sharepointHeadersWithSession(),
    body: JSON.stringify({
    }),
  });
  return respond(response, 'clear filter');
}

const applyFilter = async (itemId, resPath) => {
  const applyFilterUrl = `${GRAPH_BASE_URL}/drives/${SHAREPOINT_DRIVE_ID}/items/${itemId}/workbook/worksheets/${SHEET_RAW_INDEX}/tables/${TABLE_NAME}/columns('path')/filter/apply`;
  const response = await fetch(applyFilterUrl, {
    method: 'POST',
    headers: await sharepointHeadersWithSession(),
    body: JSON.stringify({
      criteria : {
        filterOn: 'custom',
        criterion1: `=${resPath}`,
        operator: 'or',
        criterion2: null
      }
    }),
  });
  return respond(response, 'apply filter');
}

const addTableRow = async (itemId, values) => {
  const addRowUrl = `${GRAPH_BASE_URL}/drives/${SHAREPOINT_DRIVE_ID}/items/${itemId}/workbook/worksheets/${SHEET_RAW_INDEX}/tables/${TABLE_NAME}/rows/add`;
  const response = await fetch(addRowUrl, {
    method: 'POST',
    headers: await sharepointHeaders(),
    body: JSON.stringify({ index: null, values: [values] })
  });
  return respond(response, 'add row');
}

const updateTableRow = async (itemId, values, updateIndex) => {
  const updateRowUrl = `${GRAPH_BASE_URL}/drives/${SHAREPOINT_DRIVE_ID}/items/${itemId}/workbook/worksheets/${SHEET_RAW_INDEX}/tables/${TABLE_NAME}/rows/itemAt(index=${updateIndex})`;
  const response = await fetch(updateRowUrl, {
    method: 'PATCH',
    headers: await sharepointHeaders(),
    body: JSON.stringify({ index: updateIndex, values: [values] })
  });
  return respond(response, 'update row');
}

const fetchVisibleView = async (itemId) => {
  const visibleViewUrl = `${GRAPH_BASE_URL}/drives/${SHAREPOINT_DRIVE_ID}/items/${itemId}/workbook/worksheets/${SHEET_RAW_INDEX}/tables/${TABLE_NAME}/range/visibleView/rows`;
  const vvResponse = await fetch(visibleViewUrl, {
    method: 'GET',
    headers: await sharepointHeadersWithSession(),
  });
  if (vvResponse?.ok) {
    console.log(`Got visible view: ${vvResponse.status} - ${vvResponse.statusText}`);
    return await vvResponse.json();
  } else {
    console.log(`Failed to get visible view: ${vvResponse.status} - ${vvResponse.statusText}`);
    return {};
  }
}

const findRow = (data) => {
  if (!data?.value || data.value.length < 2) return;

  return [data.value[1].cellAddresses[0], data.value[1].values[0]];
}

const findIndex = (cellAddresses) => {
  const cell = cellAddresses[0];
  return parseInt(cell.replace('A', ''), 10) - 2;
}

const reindex = async (indexPath) => {
  if (!validateConfig()) {
    return;
  }

  // const path = '/cc-shared/fragments/merch/products/catalog/merch-card/additional/postscript/default.md';
  const path = process.env.npm_config_path;
  console.log(`TEST RESOURCE PUBLISHED : path ${path}`);
  /*
  if (!path || path.endsWith('.json') || !path.includes('/merch-card/')) {
    return;
  }

  const itemId = await getItemId(indexPath);
  if (!itemId) {
    console.error('No index item id found.');
    return;
  }

  // cut off '.md'
  const resPath = path.substring(0, path.length - 3);
  const resData = await getResourceIndexData(resPath);

  await fetchSessionId(itemId);
  if (!sessionId) return;
  if (!await clearFilter(itemId)) return;
  if (!await applyFilter(itemId, resPath)) return;
  const data = await fetchVisibleView(itemId);
  const row = findRow(data);
  if (row) {
    const updateIndex = findIndex(row[0]);
    await updateTableRow(itemId, resData, updateIndex);
  } else {
    await addTableRow(itemId, resData);
  }
  */
}

reindex(PREVIEW_INDEX_FILE);
