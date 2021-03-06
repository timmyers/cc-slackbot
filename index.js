/**
 * Created by speakerwiggin on 12/28/17.
 */

const SlackBot = require('slackbots')
const secrets = require('./secrets')
const request = require('request-promise')
const _ = require('lodash')
const AsciiTable = require('ascii-table')
const fs = require('fs')
const jsdom = require('jsdom/lib/old-api').jsdom
const io = require('socket.io-client')
const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const formatterLong = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4 })

const prismCoins = 'btc,xrp,bch,ltc,xmr,dash,xem,etc,lsk,zec,steem,bcn,strat,sc,bts,doge,rep,dcr,ardr,dgb,gnt,fct,sys,nav,ppc,xcp,lbc,burst,nmc,pot,blk,grc,omni,exp,rads,clam,nxc,bcy,xbc'

// create a bot
const bot = new SlackBot({
  token: secrets.token, // Add a bot https://my.slack.com/services/new/bot and put the token
  name: secrets.name
})

/* used for production */
const defaultChannel = secrets.channel
const defaultChannelName = secrets.channelName

// more information about additional params https://api.slack.com/methods/chat.postMessage
const defaultParams = {
  icon_emoji: ':coincap:'
}

const commands = `*All commands can be started with either \`coincap\` or \`cc\`*
Here are the commands:   
    coincap help
    coincap [coin, ex: btc, :btc:, bitcoin]
    coincap [coin1] in [coin2]
    coincap [coin1,coin2,coin3...coinN] (no spaces between coins)
    
Flags:
    cc -v [coin]    verbose output
    cc -r [rank]    get coin at specified rank
    
Tables:
    cc top [limit] [sortBy]
    *sortBy can be one of: mktcap, price, supply, volume, gain, vwap, btcgain,*
    *or a comma delimited list of valid sortBy values*
    
    examples:
        \`cc top\` // displays top 10 sorted by mktcap by default
        \`cc top 5\` // top 5 sorted by mktcap
        \`cc top gain\` // top 10 sorted by 24hr % gain
        \`cc top 20 volume\` // top 20 sorted by volume
        \`cc top volume,mktcap,gain\` // top 10 sorted by volume and including mktcap & gain columns
        
Charts:
    cc chart [timePeriod] [coin]
    *timePeriod can be one of: 1, 7, 30, 90, 180, 365*
    *timePeriod defaults to 1 if not given*
    
    _Note: this command takes a few seconds longer than others,_
    _due to rendering a new chart each time. Please be patient._
    
    examples:
        \`cc chart btc\` // displays a 1day history chart for btc price
        \`cc chart 7 btc\` // displays a 7day history chart for btc price
`

/**
 * Message that bot is connected
 */
bot.on('start', () => {
  // define channel, where bot exists.
  // can be adjusted here: https://my.slack.com/services

  //bot.postMessage(defaultChannelName, 'Hello world!', defaultParams)
})

bot.on('error', err => { throw new Error(err) })
bot.on('close', () => { throw new Error('bot closed') })

function random(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function insult(channel, id) {
  const insults = [
    `Wow <@${id}>, I'm crushed.`,
    `:middle_finger: <@${id}>`,
    `<@${id}> we agreed not to see any other bots!`,
    `Am I not good enough for you <@${id}>?`
  ]

  bot.postMessage(channel, random(insults), defaultParams)
}

bot.on('message', (data) => {

  trackDisconnect()

  if (!data || data.type !== 'message' || !data.user || !data.text) return

  if (data.channel !== defaultChannel && !/^D/.test(data.channel)) return

  const channel = data.channel

  if (data.text.toLowerCase().startsWith('/coincap -o')) return insult(channel, data.user)

  const regex = /:(\w+):/g
  data.text = data.text.replace(regex, '$1')

  let args = data.text.toLowerCase().split(/\s+/)
  const arg1 = (args.shift() || '').toLowerCase()
  let command = (args.shift() || '').toLowerCase()

  if (arg1 !== 'coincap' && arg1 !== 'cc' && arg1 !== 'wen' && arg1 !== 'when') return
  console.log(args)

  if (command === 'solt') command = 'salt'
  else if (command === 'prism') {
    command = prismCoins
    args = ['in', 'eth']
  }
  if (/bee+s+h+/i.test(command)) return showCoin(channel, 'bch')

  if (/,/.test(command)) {
    const coins = command.split(',')
    coins.forEach(coin => {
      showCoin(channel, coin, ...args)
    })
    return
  }

  if (/^-/.test(command)) {
    const flags = command.split('').slice(1)

    const coin1 = flags.includes('r')
      ? coinData[coinData.ranks[parseInt(args.shift())]]
      : coinData[args.shift()]
    if (coin1 === undefined) return
    console.log(flags)

    if (flags.includes('v')) return postVerboseMessage(coin1, channel)
    else return postMessage(channel, coin1, coinData['btc'])
  }

  switch (command) {
    case 'help':
      sendHelp(channel)
      break
    case 'top':
      showTable(channel, ...args)
      break
    case 'chart':
      showChart(channel, ...args).catch(err => console.error(new Error(err)))
      break
    case 'sean':
      postMeme('sean', channel)
      break
    case 'rich':
      postMeme('rich', channel)
      break
    case 'genius':
      postMeme('genius', channel)
      break
    case 'chase':
      postMeme('chase', channel)
      break
    default:
      showCoin(channel, command, ...args)
  }
})

/**
 * If we are receiving notifications, we must be connected.
 * If we don't receive anything for a while... make a request from our
 * end to see if we can still talk to slack.
 */
let disconnectTimer
function trackDisconnect () {
  clearTimeout(disconnectTimer)
  disconnectTimer = setTimeout(async () => {
    console.log('60 seconds without any messages, check api...')
    try {
      await bot.getUser('coinbot')
    } catch (e) {
      console.error('API FAIL, try restart', e)
      process.exit(1)
    }
  }, 60000)
}

function sendHelp (channel) {
  bot.postMessage(channel, commands, defaultParams)
}

function showCoin (channel, ...args) {
  const coin1 = coinData[args.shift()]
  if (coin1 === undefined) return

  switch (args[0]) {
    case 'in':
      const coin2 = coinData[args[1]]
      if (coin2 === undefined) return
      postMessage(coin1, coin2, true, channel)
      break
    default:
      postMessage(coin1, coinData['btc'], false, channel)
  }
}

const tables = ['mktcap', 'price', 'supply', 'volume', 'gain', 'vwap', 'btcgain']
function showTable (channel, ...args) {
  const limit = isNaN(args[0]) ? 10 : parseInt(args.shift())
  const standard = args[0] === undefined
  const sortBy = standard ? 'mktcap' : args[0]
  const fields = _.intersection(sortBy.split(','), tables)
  if (fields.length === 0) return

  const table = new AsciiTable()
  if (fields.length > 1) {
    table.setHeading('', 'coin', ...fields)
  }
  else if (standard) {
    table.setHeading('', 'coin', 'price', sortBy)
  }
  else {
    table.setHeading('', 'coin', sortBy)
  }

  const sortedList = _.orderBy(coinData, fields[0], 'desc').slice(1).filter((coin, index, arr) => index === 0 ? true : coin.short !== arr[index - 1].short)

  for (let i = 0; i < limit; i++) {
    const coin = sortedList[i]
    const str = normalize(coin[sortBy], sortBy)
    if (fields.length > 1) {
      const values = fields.map(field => {
        return normalize(coin[field], field)
      })
      table.addRow(i + 1, coin.short, ...values)
    }
    else if (standard) {
      table.addRow(i + 1, coin.short, normalize(coin.price, 'price'), str)
    }
    else {
      table.addRow(i + 1, coin.short, str)
    }
  }

  if (fields.length > 1) {
    for (let i = 2; i < fields.length + 2; i++) {
      table.setAlign(i, AsciiTable.RIGHT)
    }
  }
  else if (standard) {
    table.setAlign(2, AsciiTable.RIGHT)
    table.setAlign(3, AsciiTable.RIGHT)
  }
  else {
    table.setAlign(2, AsciiTable.RIGHT)
  }
  bot.postMessage(channel, `\`\`\`\n${table.toString()}\n\`\`\``, defaultParams)
}

const times = ['1', '7', '30', '90', '180', '365']
async function showChart (channel, ...args) {
  if (args.length > 2) return
  if (args.length !== 1 && !times.includes(args[0])) return
  const timePeriod = args.length === 1 ? 1 : parseInt(args.shift())
  const coin = coinData[args[0]]
  if (coin === undefined) return

  const history = await request(coincap(`history/${timePeriod}day/${coin.short}`), { json: true }).catch(err => console.error(new Error(err)))
  const priceData = history.price.map(val => {
    return {
      x: val[0],
      value: val[1]
    }
  })

  const document = jsdom('<body><div id="container"></div></body>')
  const window = document.defaultView

  const anychart = require('anychart')(window)
  const anychartExport = require('anychart-nodejs')(anychart)

  const chart = anychart.line()
  chart.line(priceData)
  chart.bounds(0, 0, 800, 500)
  chart.container('container')
  chart.draw()

  const image = await anychartExport.exportTo(chart, 'jpg')
  fs.writeFileSync('pic.jpg', image)

  const options = {
    method: 'POST',
    url: 'https://slack.com/api/files.upload',
    formData: {
      token: secrets.token,
      channels: channel,
      file: fs.createReadStream(__dirname + '/pic.jpg'),
      filename: `${Date.now()}.jpg`,
      filetype: 'jpg'
    }
  }
  return request(options).catch(err => console.error(new Error(err)))
}

function coincap (str) {
  return `http://coincap.io/${str}`
}

function postMessage (coin1, coin2, flagged = false, channel = defaultChannelName, params = defaultParams) {
  const diff = flagged ? (coin1.perc - coin2.perc).toFixed(2) : coin1.cap24hrChange
  bot.postMessage(channel,
    `\
*${coin1.short.toUpperCase()}* \
:${/xrp/i.test(coin1.short) ? 'hankey' : coin1.short}: \
*${coin1.price < 0.10 ? formatterLong.format(coin1.price) : formatter.format(coin1.price)}* \
:${coin2.short}: \
*${coin1.short === coin2.short ? (1).toFixed(8) : (coin1.price / coin2.price).toFixed(8)}* \
${diff >= 50 ? ':moon:' : diff >= 20 ? ':rocket:' : diff >= 0 ? ':chart_with_upwards_trend:' : diff <= -50 ? ':this_is_fine:' : diff <= -20 ? ':rekt:' : ':chart_with_downwards_trend:'} \
*${diff}%*\
`, params)
}

function postMeme (name, channel = defaultChannelName) {
  const options = {
    method: 'POST',
    url: 'https://slack.com/api/files.upload',
    formData: {
      token: secrets.token,
      channels: channel,
      file: fs.createReadStream(`${__dirname}/${name}.png`),
      filename: `${name}.png`,
      filetype: 'png'
    }
  }
  return request(options).catch(err => console.error(new Error(err)))
}

function postVerboseMessage (coin, channel = defaultChannelName, params = defaultParams) {
  const loss = /-/.test(coin.cap24hrChange)
  params = Object.assign({}, params, {
    attachments: [
      {
        "color": loss ? '#ff0000' : '#00ff00',
        pretext: `:${/xrp/i.test(coin.short) ? 'hankey' : coin.short}: <http://coincap.io/${coin.short.toUpperCase()} | ${capitalize(coin.long)}> (${coin.short.toUpperCase()}) [Rank #${coin.rank} @ coincap.io]`,
        fields: [
          {
            title: 'Price',
            value: coin.price < 0.10 ? formatterLong.format(coin.price) : formatter.format(coin.price),
            short: true
          },
          {
            title: 'Volume',
            value: formatter.format(coin.volume),
            short: true
          },
          {
            title: '24hr Change',
            value: `${loss ? coin.cap24hrChange : '+' + coin.cap24hrChange}%`,
            short: true
          },
          {
            title: 'VWAP',
            value: formatter.format(coin.vwapData),
            short: true
          },
          {
            title: 'Market Cap',
            value: formatter.format(coin.mktcap),
            short: true
          },
          {
            title: 'Total Supply',
            value: coin.supply,
            short: true
          }
        ]
      }
    ]
  })
  bot.postMessage(channel, '', params)
}

function capitalize (str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
}

function normalize (data, field) {
  if (isNaN(data)) return data
  data = data.toString()
  switch (field) {
    case 'mktcap':
    case 'price':
    case 'volume':
    case 'vwap':
      return formatter.format(data)
    case 'gain':
    case 'btcgain':
      return (+data).toFixed(2).toString() + ' %'
    case 'supply':
      return (+data).toLocaleString()
  }
}

const coinData = {}
coinData.ranks = []
async function getFront () {
  return request(coincap('front'), { json: true })
    .then((coins) => {
      coins.forEach((coin, rank) => {
        updateCoinData(Object.assign({}, coin, {
          rank: rank + 1,
          gain: coin.perc,
          vwap: coin.vwapData,
          btcgain: coin.short.toLowerCase() === 'btc' ? 'N/A' : (coin.perc - coinData['btc'].perc)
        }))
        coinData.ranks[rank + 1] = coin.short.toLowerCase()
      })
    })
    .catch(err => { throw new Error(err) })
}

function updateCoinData (coin) {
  if (coinData[coin.short.toLowerCase()] === undefined) {
    coinData[coin.short.toLowerCase()] = {}
  }
  if (coinData[coin.long.toLowerCase()] === undefined) {
    coinData[coin.long.toLowerCase()] = {}
  }
  coinData[coin.short.toLowerCase()] = Object.assign(coinData[coin.short.toLowerCase()], coin)
  coinData[coin.long.toLowerCase()] = Object.assign(coinData[coin.long.toLowerCase()], coin)
}

getFront()
  .then(() => {
    console.log('starting socket')
    const socket = io.connect('https://coincap.io')

    socket.on('connect', () => {
      console.log('socket connected')
    })

    socket.on('trades', (trade) => {
      try {
        const { msg: coin } = trade
        updateCoinData(coin)
      }
      catch (e) { console.error(new Error(e)) }
    })

    setInterval(async () => {
      console.log('getting coincap front')
      return await getFront()
    }, 30000)
  })
