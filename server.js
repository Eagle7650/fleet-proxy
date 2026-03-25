const express = require('express')
const cors    = require('cors')
const fetch   = require('node-fetch')

const app  = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json({ limit: '10mb' }))

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Fleet Tracker Proxy running' })
})

// Anthropic proxy — no timeout issues
app.post('/api/claude', async (req, res) => {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':       'application/json',
        'x-api-key':          process.env.ANTHROPIC_API_KEY,
        'anthropic-version':  '2023-06-01'
      },
      body: JSON.stringify(req.body)
    })
    const data = await response.json()
    res.status(response.status).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.listen(PORT, () => {
  console.log(`Fleet Proxy running on port ${PORT}`)
})
