#!/usr/bin/env node
'use strict'

// Project Dependencies
const ora = require('ora')
const chalk = require('chalk')
const prompt = require('prompt')
const moment = require('moment')
const dodgem = require('caporal')
const puppeteer = require('puppeteer')
const capitalize = require('capitalize')
const Preferences = require('preferences')

// Files
const pjson = require('./package.json')
const regex = require('./regex')

// Convenience
const projectName = capitalize(pjson.name)

// Preferences
let prefs = new Preferences('com.jamiestraw.dodgem')

/**
 * Initializes the headless browser and page
 *
 * @param {Object} args
 * @param {Object} opts
 * @returns {Promise.<Array>}
 */
async function boot (args, opts) {
  console.log(chalk.magenta(`
    ____            __
   / __ \\____  ____/ /___ ____  ____ ___ 
  / / / / __ \\/ __  / __ \`/ _ \\/ __ \`__ \\
 / /_/ / /_/ / /_/ / /_/ /  __/ / / / / /
/_____/\\____/\\__,_/\\__, /\\___/_/ /_/ /_/ 
                  /____/         ${chalk.yellow.italic(`v${pjson.version}`)}
  `))

  const browser = await puppeteer.launch()
  const page = await browser.newPage()

  const target = args.target === 'oldest' ? 'the oldest trade' : 'all trades'
  ora(`${projectName} will bump ${chalk.blue(target)} every ${chalk.blue(args.interval)} minutes`).info()

  return [page, args, opts]
}

/**
 * Logs in to RLG using stored credentials
 *
 * @param {Page} page
 * @param {Object} args
 * @param {Object} opts
 * @returns {Promise.<Array>}
 */
async function login ([page, args, opts]) {
  const spinner = ora(`Logging in as: ${chalk.blue(prefs.emailAddress)}`).start()
  await page.goto('https://rocket-league.com/login')

  // Email Address
  await page.focus('.rlg-form .rlg-input[type="email"]')
  await page.type(prefs.emailAddress)

  // Password
  await page.focus('.rlg-form .rlg-input[type="password"]')
  await page.type(prefs.password)

  // Submit
  await page.click('.rlg-form .rlg-btn-primary[type="submit"]')
  await page.waitForNavigation()

  spinner.succeed(`Logged in as: ${chalk.blue(prefs.emailAddress)}`)
  return [page, args, opts]
}

/**
 * Scrapes active trade listings
 *
 * @param {Page} page
 * @param {Object} args
 * @param {Object} opts
 * @returns {Promise.<Array>}
 */
async function scrapeTrades ([page, args, opts]) {
  // Navigate to trades
  const spinner = ora('Finding active trades').start()
  await page.goto(`https://rocket-league.com/trades/${prefs.username}`)  // @TODO: Eventually remove username

  // Scrape trades
  let tradeUrls = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('.rlg-trade-display-header > a'))
    return anchors.map(anchor => anchor.href)
  })
  spinner.succeed(`Found ${chalk.blue(tradeUrls.length)} active trade${tradeUrls.length === 1 ? '' : 's'}`)

  // @TODO: Filter out trades that are not editable due to 15 minute cool-off period

  if (args.target === 'oldest') tradeUrls = [tradeUrls[tradeUrls.length - 1]]
  return [page, args, opts, tradeUrls]
}

/**
 * Loop through trade URLs and update each trade listing
 *
 * @param {Page} page
 * @param {Object} args
 * @param {Object} opts
 * @param {Object[]} tradeUrls
 * @returns {Promise.<Array>}
 */
async function updateTrades ([page, args, opts, tradeUrls]) {
  for (let [index, tradeUrl] of tradeUrls.entries()) {
    const humanIndex = index + 1
    const start = moment()
    const spinner = ora(args.target === 'oldest'
      ? 'Bumping oldest active trade'
      : `Bumping trade ${humanIndex}/${tradeUrls.length}`
    ).start()

    try {
      // Navigate to trade
      await page.goto(tradeUrl)

      // Edit trade
      await page.click("[href^='/trade/edit']")
      await page.waitForNavigation()

      // Save
      await page.click('#rlg-addTradeForm input[type=submit]')
      await page.waitForNavigation()

      const secondsElapsed = moment().diff(start, 'seconds')
      spinner.succeed(args.target === 'oldest'
        ? `Bumped oldest active trade ${chalk.dim(`(${secondsElapsed} seconds)`)}`
        : `Bumped trade ${humanIndex}/${tradeUrls.length} ${chalk.dim(`(${secondsElapsed} seconds)`)}`
      )
    } catch (error) {
      // @TODO: Add error logging to file

      const secondsElapsed = moment().diff(start, 'seconds')
      spinner.fail(args.target === 'oldest'
        ? `Failed to bump oldest active trade ${chalk.dim(`(${secondsElapsed} seconds)`)}`
        : `Failed to bump trade ${humanIndex}/${tradeUrls.length} ${chalk.dim(`(${secondsElapsed} seconds)`)}`
      )
    }
  }

  return [page, args, opts]
}

/**
 * Schedule the next call to updateTrades
 *
 * @param {Page} page
 * @param {Object} args
 * @param {Object} opts
 */
function scheduleUpdateTrades ([page, args, opts]) {
  const minutes = args.interval
  const nextRunTs = moment().add(minutes, 'minutes').format('HH:mm:ss')

  ora(`${projectName} will run again at: ${chalk.green(nextRunTs)}`).info()

  setTimeout(() => {
    scrapeTrades([page, args, opts])
      .then(updateTrades)
      .then(scheduleUpdateTrades)
  }, 1000 * 60 * minutes)
}

/**
 * @TODO: Doc-block
 */
async function setLogin () {
  console.log('')
  ora('Please enter login credentials for Rocket League Garage').info()

  prompt.message = 'Rocket League Garage'
  prompt.delimiter = ' > '
  prompt.start()
  prompt.get({
    properties: {
      username: {
        description: 'Username',
        pattern: regex.nonWhiteSpace,
        message: 'Please enter a valid username',
        required: true
      },
      emailAddress: {
        description: 'Email Address',
        pattern: regex.emailAddress,
        message: 'Please enter a valid email address',
        required: true
      },
      password: {
        description: 'Password',
        hidden: true,
        replace: '*',
        pattern: regex.nonWhiteSpace,
        message: 'Please enter a valid password',
        required: true
      }
    }
  }, (error, credentials) => {
    if (error) return console.log(chalk.red('\n\nLogin aborted'))

    // @TODO: Verify that credentials are valid
    const spinner = ora(`Saving credentials for: ${chalk.blue(credentials.emailAddress)}`).start()
    spinner.succeed(`Credentials verified and saved for: ${chalk.blue(credentials.emailAddress)}`)

    prefs.username = credentials.username
    prefs.emailAddress = credentials.emailAddress
    prefs.password = credentials.password
  })
}

dodgem
  .version(pjson.version)
  .help(`🎪  ${projectName} - ${pjson.description} - v${pjson.version}`)

  // Bump
  .command('bump', 'Begin bumping active trades')
  .argument('<target>', `Which trades to bump - ${chalk.blue('all')} or ${chalk.blue('oldest')}`, ['all', 'oldest'], 'all')
  .argument('<interval>', 'How many minutes to wait before bumping again', /^\d*$/, 15)
  .action((args, opts) => {
    boot(args, opts)
      .then(login)
      .then(scrapeTrades)
      .then(updateTrades)
      .then(scheduleUpdateTrades)
  })

  // Login
  .command('login', 'Set login credentials for Rocket League Garage')
  .action(setLogin)

dodgem.parse(process.argv)