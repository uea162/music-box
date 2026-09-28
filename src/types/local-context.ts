export interface CoarseLocation {
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface CurrentWeather {
  temperatureC: number;
  weatherCode: number;
}
