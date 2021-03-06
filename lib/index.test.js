const moment = require('moment-timezone');
const AlwaysOnCalculator = require('./index');
const dataOfOneMonth = require('../fixtures/sample15minOfOneMonth.json');

function createThenableMock(response) {
  return jest.fn().mockReturnValue(Promise.resolve(response));
}

function getInstance() {
  const option = {
    accessToken: 'abcd',
  };
  const instance = new AlwaysOnCalculator(option);

  instance.getTimezone = createThenableMock('US/Pacific');
  instance.getUsages = createThenableMock({ items: [] });

  return instance;
}

test('throw error by option validation', () => {
  expect(() => new AlwaysOnCalculator()).toThrow();
  expect(() => new AlwaysOnCalculator({
    apiClient: null,
  })).toThrow();
  expect(() => new AlwaysOnCalculator({
    accessToken: '',
  })).toThrow();
});

test('pass the validation', () => {
  expect(() => new AlwaysOnCalculator({
    accessToken: 'abcd',
  })).not.toThrow();
});

test('it has default filter', () => {
  const instance = getInstance();

  instance.filters.forEach((ft) => {
    expect(ft).toBeInstanceOf(Function);
    expect(ft.name).toBe('wrappedFilter');
  });
});

test('set custom filters', () => {
  const instance = getInstance();
  const createCustomFilter = () => items => items.filter((item, index) => index % 2 === 0);
  const myCustomFilters = [
    createCustomFilter(),
    createCustomFilter(),
    createCustomFilter(),
  ];

  expect(() => instance.setFilters(myCustomFilters)).not.toThrow();
  instance.filters.forEach((ft) => {
    expect(ft).toBeInstanceOf(Function);
    expect(ft.name).toBe('wrappedFilter');
  });
});

test('prevent an invalid custom filter', () => {
  const instance = getInstance();
  const invalidFilter = () => 'invalid';

  expect(() => instance.setFilters(invalidFilter)).toThrow();
});

test('baseTime is optional', () => {
  const instance = getInstance();
  expect(() => instance.calculate({
    siteHash: 'abcd',
  })).not.toThrow();
});

test('throw error by missing siteHash', () => {
  const instance = getInstance();
  expect(() => instance.calculate({
    siteHash: null,
  })).toThrow();
});

test('get timezone and usages before performing the calculation', () => {
  const instance = getInstance();

  return instance.calculate({
    siteHash: 'site',
    baseTime: moment.tz('2017-11-01', 'US/Pacific'),
  }).then(() => {
    expect(instance.getTimezone).toBeCalledWith('site', undefined);
    expect(instance.getUsages).toBeCalledWith('site', expect.objectContaining({
      start: expect.any(Number),
      end: expect.any(Number),
      period: '15min',
    }));
  });
});

describe('calculation logic', () => {
  test('pickItems', () => {
    const usages = [
      { timestamp: 1, usage: 100 },
      { timestamp: 2, usage: 200 },
      { timestamp: 3, usage: 300 },
    ];
    expect(AlwaysOnCalculator.pickItems({ items: usages })).toEqual(usages);
  });

  test('pickItems filters empty item', () => {
    const usages = [
      { timestamp: 1, usage: 100 },
      { timestamp: 2, usage: 0 },
      { timestamp: 3, usage: 300 },
    ];
    expect(AlwaysOnCalculator.pickItems({ items: usages })).toEqual([
      { timestamp: 1, usage: 100 },
      { timestamp: 3, usage: 300 },
    ]);
  });

  test('minimumDailyUsageFilter', () => {
    const timezone = 'Asia/Seoul';
    const items = [
      {
        timestamp: moment.tz('2017-11-08 14:00', timezone).valueOf(),
        usage: 10000,
      },
      {
        timestamp: moment.tz('2017-11-08 19:00', timezone).valueOf(),
        usage: 9900,  // minimum of 2017-11-08
      },
      {
        timestamp: moment.tz('2017-11-08 20:15', timezone).valueOf(),
        usage: 20000,
      },
      {
        timestamp: moment.tz('2017-11-09 01:00', timezone).valueOf(),
        usage: 25000, // minimum of 2017-11-09
      },
      {
        timestamp: moment.tz('2017-11-09 04:00', timezone).valueOf(),
        usage: 26000,
      },
    ];
    expect(AlwaysOnCalculator.minimumDailyUsageFilter(items, { timezone })).toEqual([
      {
        timestamp: moment.tz('2017-11-08 19:00', timezone).valueOf(),
        usage: 9900,
      },
      {
        timestamp: moment.tz('2017-11-09 01:00', timezone).valueOf(),
        usage: 25000,
      },
    ]);
  });

  test('sleepTimeFilter', () => {
    const timezone = 'Asia/Seoul';
    const setting = {
      timezone,
    };
    const items = [
      { timestamp: moment.tz('2017-11-08 14:00', timezone).valueOf() },
      { timestamp: moment.tz('2017-11-08 15:00', timezone).valueOf() },
      { timestamp: moment.tz('2017-11-08 20:59', timezone).valueOf() },
      { timestamp: moment.tz('2017-11-08 22:01', timezone).valueOf() }, // included
      { timestamp: moment.tz('2017-11-08 05:00', timezone).valueOf() }, // included
      { timestamp: moment.tz('2017-11-08 05:59', timezone).valueOf() }, // included
      { timestamp: moment.tz('2017-11-08 06:01', timezone).valueOf() },
    ];

    expect(AlwaysOnCalculator.sleepTimeFilter(items, setting)).toEqual([
      { timestamp: moment.tz('2017-11-08 22:01', timezone).valueOf() },
      { timestamp: moment.tz('2017-11-08 05:00', timezone).valueOf() },
      { timestamp: moment.tz('2017-11-08 05:59', timezone).valueOf() },
    ]);
  });

  test('sleepTimeFilter with actual data', () => {
    const setting = {
      timezone: 'Asia/Seoul',
    };

    // The fixture includes data for October, 2017
    // (8 hours * 4 quarter) items * 31 days = 992
    expect(AlwaysOnCalculator.sleepTimeFilter(dataOfOneMonth, setting).length).toBe(992);
  });

  test('consistentItemsFilter', () => {
    const items = [
      { timestamp: 1, usage: 1000 },
      { timestamp: 2, usage: 2000 },
      { timestamp: 3, usage: 4000 }, // consistent
      { timestamp: 3, usage: 4500 }, // consistent
      { timestamp: 5, usage: 4990 }, // consistent
      { timestamp: 6, usage: 5500 },
      { timestamp: 7, usage: 6000 },
    ];

    expect(AlwaysOnCalculator.consistentItemsFilter(items)).toEqual([
      { timestamp: 3, usage: 4000 },
      { timestamp: 3, usage: 4500 },
      { timestamp: 5, usage: 4990 },
    ]);
  });

  test('consistentItemsFilter should retain items if there are more than three items', () => {
    const items = [
      { timestamp: 1, usage: 1000 },
      { timestamp: 2, usage: 2000 },
      { timestamp: 3, usage: 4000 }, // consistent
      { timestamp: 4, usage: 4100 }, // consistent
      { timestamp: 5, usage: 4290 }, // consistent
      { timestamp: 6, usage: 3900 }, // consistent
      { timestamp: 7, usage: 4990 }, // consistent
      { timestamp: 8, usage: 6000 },
    ];

    expect(AlwaysOnCalculator.consistentItemsFilter(items)).toEqual([
      { timestamp: 3, usage: 4000 },
      { timestamp: 4, usage: 4100 },
      { timestamp: 5, usage: 4290 },
      { timestamp: 6, usage: 3900 },
      { timestamp: 7, usage: 4990 },
    ]);
  });

  test('consistentItemsFilter should save at the last index', () => {
    const items = [
      { timestamp: 1, usage: 1000 },
      { timestamp: 2, usage: 2000 },
      { timestamp: 3, usage: 4000 },
      { timestamp: 4, usage: 5500 },
      { timestamp: 5, usage: 7090 }, // consistent
      { timestamp: 6, usage: 7100 }, // consistent
      { timestamp: 7, usage: 7290 }, // consistent
      { timestamp: 8, usage: 8000 }, // consistent
    ];

    expect(AlwaysOnCalculator.consistentItemsFilter(items)).toEqual([
      { timestamp: 5, usage: 7090 },
      { timestamp: 6, usage: 7100 },
      { timestamp: 7, usage: 7290 },
      { timestamp: 8, usage: 8000 },
    ]);
  });

  test('computeAverage', () => {
    const items = [
      { timestamp: 3, usage: 4000 },
      { timestamp: 4, usage: 4100 },
      { timestamp: 5, usage: 4290 },
      { timestamp: 6, usage: 3900 },
      { timestamp: 7, usage: 4990 },
    ];
    const expected = (items.map(({ usage }) => usage).reduce((a, b) => a + b, 0)) / items.length;

    expect(AlwaysOnCalculator.computeAverage(items)).toBeCloseTo(expected);
  });
});
