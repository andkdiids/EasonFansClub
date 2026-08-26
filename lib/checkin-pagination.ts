export const CHECK_IN_MESSAGE_PAGE_SIZE = 5
export const CHECK_IN_DESKTOP_MESSAGE_PAGE_SIZE = 7

export function getCheckInMessagePageSize(isDesktop: boolean) {
  return isDesktop ? CHECK_IN_DESKTOP_MESSAGE_PAGE_SIZE : CHECK_IN_MESSAGE_PAGE_SIZE
}
