import xmlService from 'xml';

import S3ERRORS from './s3Errors.json';

/**
 * setCommonResponseHeaders - Set HTTP response headers
 * @param {object} headers - key and value of new headers to add
 * @param {object} response - http response object
 * @param {object} log - Werelogs logger
 * @return {object} response - response object with additional headers
 */
function setCommonResponseHeaders(headers, response, log) {
    if (headers && typeof headers === 'object') {
        log.debug(`Setting response headers: ${JSON.stringify(headers)}`);
        Object.keys(headers).forEach((key) => {
            if (headers[key]) {
                response.setHeader(key, headers[key]);
            }
        });
    }
    response.setHeader('server', 'AmazonS3');
    // to be expanded in further implementation of logging of requests
    response.setHeader('x-amz-id-2', log.getSerializedUids());
    response.setHeader('x-amz-request-id', log.getSerializedUids());
    return response;
}
/**
 * okHeaderResponse - Response with only headers, no body
 * @param {object} headers - key and value of new headers to add
 * @param {object} response - http response object
 * @param {number} httpCode -- http response code
 * @param {object} log - Werelogs logger
 * @return {object} response - response object with additional headers
 */
function okHeaderResponse(headers, response, httpCode, log) {
    log.info(`Sending success header response`);
    setCommonResponseHeaders(headers, response, log);
    log.debug(`HttpCode: ${httpCode}`);
    response.writeHead(httpCode);
    return response.end(() => {
        log.info('Response ended');
    });
}

/**
 * okXMLResponse - Response with XML body
 * @param {string} xml - XML body as string
 * @param {object} response - http response object
 * @param {object} log - Werelogs logger
 * @return {object} response - response object with additional headers
 */
function okXMLResponse(xml, response, log) {
    log.info(`Sending success XML response`);
    setCommonResponseHeaders(null, response, log);
    response.writeHead(200, {
        'Content-type': 'application/xml'
    });
    log.debug(`XML response: ${xml}`);
    return response.end(xml, 'utf8', () => {
        log.info('Response ended');
    });
}

function errorXMLResponse(errCode, response, log) {
    log.info(`Sending error XMl response for error: ${errCode}`);
    const result = { xml: '', httpCode: 500 };
    /*
    <?xml version="1.0" encoding="UTF-8"?>
     <Error>
     <Code>NoSuchKey</Code>
     <Message>The resource you requested does not exist</Message>
     <Resource>/mybucket/myfoto.jpg</Resource>
     <RequestId>4442587FB7D0A2F9</RequestId>
     </Error>
     */
    const errObj = S3ERRORS[errCode] ? S3ERRORS[errCode]
        : S3ERRORS.InternalError;
    const errXMLObj = [
        {
            'Error': [
                {
                    'Code': errCode
                }, {
                    'Message': errObj.description
                }, {
                    'Resource': ''
                }, {
                    'RequestId': ''
                }
            ]
        }
    ];
    result.xml = xmlService(errXMLObj, { declaration: { encoding: 'UTF-8' }});
    log.debug(`Error XML: {result.xml}`);
    setCommonResponseHeaders(null, response, log);
    response.writeHead(errObj.httpCode, {
        'Content-type': 'application/xml'
    });
    log.debug(`HttpCode: ${errObj.httpCode}`);
    return response.end(result.xml, 'utf8', () => {
        log.info('Response ended');
    });
}

/**
 * Modify response headers for an objectGet or objectHead request
 * @param {object} overrideHeaders - headers in this object override common
 * headers. These are extracted from the request object
 * @param {object} resHeaders - object with common response headers
 * @param {object} response - router's response object
 * @param {object} log - Werelogs logger
 * @return {object} response - modified response object
 */
function okContentHeadersResponse(overrideHeaders, resHeaders, response, log) {
    const addHeaders = {};
    Object.assign(addHeaders, resHeaders);

    if (overrideHeaders['response-content-type']) {
        addHeaders['Content-Type'] = overrideHeaders['response-content-type'];
    }
    if (overrideHeaders['response-content-language']) {
        addHeaders['Content-Language'] =
            overrideHeaders['response-content-language'];
    }
    if (overrideHeaders['response-expires']) {
        addHeaders.Expires = overrideHeaders['response-expires'];
    }
    if (overrideHeaders['response-cache-control']) {
        addHeaders['Cache-Control'] = overrideHeaders['response-cache-control'];
    }
    if (overrideHeaders['response-content-disposition']) {
        addHeaders['Content-Disposition'] =
        overrideHeaders['response-content-disposition'];
    }
    if (overrideHeaders['response-content-encoding']) {
        addHeaders['Content-Encoding'] =
            overrideHeaders['response-content-encoding'];
    }

    setCommonResponseHeaders(addHeaders, response, log);
    response.writeHead(200);
    return response;
}

const routesUtils = {
    /**
     * @param {string} errCode - S3 error Code
     * @param {string} xml - xml body as string conforming to S3's spec.
     * @param {object} response - router's response object
     * @param {object} log - Werelogs logger
     * @return {function} - error or success response utility
     */
    responseXMLBody(errCode, xml, response, log) {
        if (errCode && !response.headersSent) {
            return errorXMLResponse(errCode, response, log);
        }
        if (!response.headersSent) {
            return okXMLResponse(xml, response, log);
        }
    },

    /**
     * @param {string} errCode - S3 error Code
     * @param {string} resHeaders - headers to be set for the response
     * @param {object} response - router's response object
     * @param {number} httpCode - httpCode to set in response
     *   If none provided, defaults to 200.
     * @param {object} log - Werelogs logger
     * @return {function} - error or success response utility
     */
    responseNoBody(errCode, resHeaders, response, httpCode = 200, log) {
        if (errCode && !response.headersSent) {
            return errorXMLResponse(errCode, response, log);
        }
        if (!response.headersSent) {
            return okHeaderResponse(resHeaders, response, httpCode, log);
        }
    },

    /**
     * @param {string} errCode - S3 error Code
     * @param {object} overrideHeaders - headers in this object override common
     * headers. These are extracted from the request object
     * @param {string} resHeaders - headers to be set for the response
     * @param {object} response - router's response object
     * @param {object} log - Werelogs logger
     * @return {object} - router's response object
     */
    responseContentHeaders(errCode, overrideHeaders, resHeaders, response,
        log) {
        if (errCode && !response.headersSent) {
            return errorXMLResponse(errCode, response, log);
        }
        if (!response.headersSent) {
            okContentHeadersResponse(overrideHeaders, resHeaders, response,
                log);
        }
        return response.end(() => {
            log.info('Response ended');
        });
    },

    /**
     * @param {string} errCode - S3 error Code
     * @param {object} overrideHeaders - headers in this object override common
     * headers. These are extracted from the request object
     * @param {string} resHeaders - headers to be set for the response
     * @param {object} readStream - instance of Node.js' Stream interface to
     * stream data in the response
     * @param {object} response - router's response object
     * @param {object} log - Werelogs logger
     * @return {object} - router's response object
     */
    responseStreamData(errCode, overrideHeaders,
            resHeaders, readStream, response, log) {
        if (errCode && !response.headersSent) {
            return errorXMLResponse(errCode, response, log);
        }
        if (!response.headersSent) {
            okContentHeadersResponse(overrideHeaders, resHeaders, response,
                log);
        }
        readStream.pipe(response, { end: false });
        readStream.on('end', function readStreamRes() {
            return response.end(() => {
                log.info('Response ended');
            });
        });
    }
};

export default routesUtils;