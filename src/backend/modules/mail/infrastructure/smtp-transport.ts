import nodemailer from 'nodemailer'
import type { Mail_Options } from '../mail-options'

/** The connection to the SMTP server. */
export function smtpTransport(options: Mail_Options) {
  return nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure,
    auth: options.user ? { user: options.user, pass: options.password } : undefined,
  })
}
