import { EU_CONSTANTS } from './../constants';
import { BlueLinkyConfig, Session } from './../interfaces/common.interfaces';
import * as pr from 'push-receiver';
import got from 'got';
import { ALL_ENDPOINTS, EU_BASE_URL } from '../constants';
import { Vehicle } from '../vehicles/vehicle';
import EuropeanVehicle from '../vehicles/europianVehicle';
import SessionController from './controller';

import logger from '../logger';
import { URLSearchParams } from 'url';

import { CookieJar } from 'tough-cookie';
export class EuropeanController implements SessionController {

  constructor(config: BlueLinkyConfig) {
    this.config = config;
    logger.info(`${this.config.region} Controller created`);
  }

  session: Session = {
    accessToken: '',
    refreshToken: '',
    controlToken: '',
    deviceId: '',
  };

  private vehicles: Array<EuropeanVehicle> = [];

  public config: BlueLinkyConfig = {
    username: null,
    password: null,
    region: 'EU',
    autoLogin: true,
    pin: null,
    vin: null,
    deviceUuid: null
  };

  async refreshAccessToken(): Promise<string> {
    return this.login();
  }

  async enterPin(): Promise<string> {
    if(this.session.accessToken === '') {
      Promise.reject('Token not set');
    }

    const response = await got(`${EU_BASE_URL}/api/v1/user/pin`, {
      method: 'PUT',
      headers: {
        'Authorization': this.session.accessToken,
        'Content-Type': 'application/json'
      },
      body: {
        deviceId: this.session.deviceId,
        pin: this.config.pin
      },
      json: true
    });

    this.session.controlToken = 'Bearer ' + response.body.controlToken;
    setTimeout(() => {
        this.session.controlToken = '';
        logger.info('Control token timed out!');
    }, response.body.expiresTime * 1000);
    logger.info('PIN entered OK, The pin is valid for 10 minutes')
    return Promise.resolve('PIN entered OK, The pin is valid for 10 minutes');

  }

  async login(): Promise<string> {
     try {
      // request cookie via got and store it to the cookieJar
      const cookieJar = new CookieJar();
      await got(ALL_ENDPOINTS.EU.session, { cookieJar });

      const authCodeResponse = await got(ALL_ENDPOINTS.EU.login, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        json: true,
        body: {
          email: this.config.username,
          password: this.config.password
        },
        cookieJar
      });

      // spooky :), seems like regex might work better here?
      const authCode = authCodeResponse.body.redirectUrl.split('?')[1].split('&')[0].split('=')[1];
      this.session.refreshToken = authCode;

      logger.info(JSON.stringify(authCodeResponse.body));
      // Not entierly sure we need notifications right now so I've commented so that
      // when I am testing it works without issues, feel free to put back
  
      const credentials = await pr.register(EU_CONSTANTS.GCMSenderID);
      console.log('cred', this.config);
      
      const notificationReponse = await got(`${EU_BASE_URL}/api/v1/spa/notifications/register`, {
        method: 'POST',
        headers: {
          'ccsp-service-id': '6d477c38-3ca4-4cf3-9557-2a1929a94654',
          'Content-Type':	'application/json;charset=UTF-8',
          'Content-Length':	'231',
          'Host':	'prd.eu-ccapi.hyundai.com:8080',
          'Connection':	'Keep-Alive',
          'Accept-Encoding':	'gzip',
          'User-Agent':	'okhttp/3.10.0'
        },
        body: {
          pushRegId: credentials.gcm.token,
          pushType: 'GCM',
          uuid: this.config.deviceUuid
        },
        json: true
      });

      this.session.deviceId = notificationReponse.body.resMsg.deviceId;

      const formData = new URLSearchParams();
      formData.append('grant_type', 'authorization_code');
      formData.append('redirect_uri', ALL_ENDPOINTS.EU.redirectUri);
      formData.append('code', authCode);

      const response = await got(ALL_ENDPOINTS.EU.token, {
        method: 'POST',
        headers: {
          'Authorization': EU_CONSTANTS.basicToken,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length':'154',
          'Host': 'prd.eu-ccapi.hyundai.com:8080',
          'Connection':'Keep-Alive',
          'Accept-Encoding':'gzip',
          'User-Agent': 'okhttp/3.10.0',
          'grant_type': 'authorization_code'
        },
        body: formData.toString(),
        cookieJar
      });

      const responseBody = JSON.parse(response.body);
      this.session.accessToken = 'Bearer ' + responseBody.access_token;

      logger.info(`Login successful for user ${this.config.username}`, this.session.accessToken);

      // we can't do this type of logic to keep the library running
      // seems like a bad flow imo
      // setInterval(() => {
      //   logger.info(`Access token expiered, getting a new one for ${this.config.username}`);
      //   this.refreshAccessToken();
      // }, responseBody.expires_in * 1000);

      return Promise.resolve('Login success');
    } catch (err) {
      logger.debug(JSON.stringify(err.message));
      return Promise.reject(err.message);
    }

  }

  logout(): Promise<string> {
    return Promise.resolve('OK');
  }

  async getVehicles(): Promise<Array<Vehicle>> {
    logger.info('getVehicles ' + this.session.accessToken)
    if(this.session.accessToken === undefined) {
      return Promise.reject('Token not set');
    }

    const response = await got(`${EU_BASE_URL}/api/v1/spa/vehicles`, {
      method: 'GET',
      headers: {
        'Authorization': this.session.accessToken,
        'ccsp-device-id': this.session.deviceId
      },
      json: true
    });

    this.vehicles = [];

    response.body.resMsg.vehicles.forEach(v => {
      const config = {
        master: v.master,
        nickname: v.nickname,
        regDate: v.regDate,
        type: v.type,
        id: v.vehicleId,
        name: v.vehicleName
      }
      this.vehicles.push(new EuropeanVehicle(config, this.session));
    });

    logger.info(`Success! Got ${this.vehicles.length} vehicles`)
    return Promise.resolve(this.vehicles);
      
  }
}
