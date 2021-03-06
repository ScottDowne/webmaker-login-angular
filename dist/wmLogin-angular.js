var module = angular.module('wmLoginAngular', ['templates-wmLoginAngular']);

module.constant('CONFIG', window.angularConfig);

module.constant('wmRegex',{
  username: /^[abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789\-]{1,20}$/,
  email: /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/
});

module.factory('focus', [ '$timeout',
  function ($timeout) {
    return function (selector) {
      // Timeout used to ensure that the DOM has the input that needs to be focused on
      $timeout(function () {
        var el = angular.element(selector);
        if ( !el || !el[0] ) {
          return;
        }
        el[0].focus();
      }, 0);
    };
  }
]);

module.factory('passwordValidator', [
  function() {
    return function($scope, password, blur) {

      if ( !password ) {
        $scope.eightCharsState = $scope.oneEachCaseState = $scope.oneNumberState = 'default';
        $scope.isValidPassword = false;
        return;
      }

      var lengthValid = password.length >= 8,
          validCase = password.match(/^.*(?=.*[a-z])(?=.*[A-Z]).*$/),
          hasNumber = password.match(/\d/);

      $scope.eightCharsState = !lengthValid ? 'invalid' : blur ? 'valid' : '';
      $scope.oneEachCaseState = !validCase ? 'invalid' : blur ? 'valid' : '';
      $scope.oneNumberState = !hasNumber ? 'invalid' : blur ? 'valid' : '';
      $scope.isValidPassword = lengthValid && validCase && hasNumber;
    };
  }
]);

module.factory('wmLoginService', ['$rootScope', '$modal', '$window', '$location', 'CONFIG',
  function ($rootScope, $modal, $window, $location, CONFIG) {

    // This is needed to apply scope changes for events that happen in
    // async callbacks.
    function apply() {
      if (!$rootScope.$$phase) {
        $rootScope.$apply();
      }
    }

    var auth = new $window.WebmakerAuthClient({
      host: '',
      csrfToken: CONFIG.csrf,
      handleNewUserUI: false
    });

    // Set up user data
    $rootScope._user = {};

    $rootScope.logout = auth.logout;

    $rootScope.lang = CONFIG.lang;

    auth.on('logout', function (why) {
      $rootScope._user = {};
      apply();
    });

    auth.on('tokenlogin', function (user) {
      $location.search('uid', null);
      $location.search('token', null);
      $location.search('validFor', null);
      $rootScope._user = user;
      apply();
    });

    auth.on('passwordlogin', function (user) {
      $rootScope._user = user;
      apply();
    });

    $rootScope.login =  auth.login;

    auth.on('login', function (user) {
      $rootScope._user = user;
      apply();
    });


    auth.on('error', function (message, xhr) {
      console.error('error', message, xhr);
    });

    var searchObj = $location.search();

    // see if we can try to instantly log in with an OTP
    if (searchObj.uid && searchObj.token) {
      auth.authenticateToken(searchObj.uid, searchObj.token, searchObj.validFor);
    }

    auth.verify();

    return auth;
  }
]);

module.directive('wmCreateUser', [
  function() {


    return {
      restrict: 'A',
      link: function($scope, $element) {
        $element.on('click', function() {
          $scope.wmCreateUser();
        });
      },
      controller:['$rootScope', '$scope', '$http', '$modal', '$timeout', 'focus', 'wmLoginService', 'wmRegex',
      function($rootScope, $scope, $http, $modal, $timeout, focus, wmLoginService, wmRegex) {

        function apply() {
          if (!$rootScope.$$phase) {
            $rootScope.$apply();
          }
        }

        $rootScope.wmCreateUser = function (email, username) {
          $modal.open({
            templateUrl: 'create-user-modal.html',
            controller: createUserController,
            resolve: {
              email: function () {
                return email;
              },
              username: function () {
                return username;
              }
            }
          }).opened
            .then(function () {
              focus('input[focus-on="create-user-email"]');
            });
        };

        function createUserController($scope, $modalInstance, email, username) {

          $scope.form = {};
          $scope.user = {};

          $scope.user.email = email;
          $scope.user.username = username;

          $scope.enterEmail = true;
          $scope.selectUsername = false;
          $scope.welcome = false;

          function getModalIdx() {
            return Math.floor(Math.random() * 4);
          }

          $scope.submitEmail = function () {
            $scope.submit = true;
            if ($scope.form.agree && $scope.user.email) {
              $scope.enterEmail = false;
              $scope.selectUsername = true;
              focus('input[focus-on="create-user-username"]');
            }
          };

          $scope.checkEmail = function () {
            if (!$scope.user.email) {
              return;
            }

            var isValid = wmRegex.email.test($scope.user.email);

            $scope.form.user.email.$setValidity('invalidEmail', isValid);
            $scope.form.user.email.$setValidity('noAccount', true);

            if (!isValid) {
              return;
            }

            wmLoginService.uidExists($scope.user.email, function(err, resp) {
              $scope.form.user.email.$setValidity('serverError', !!err);
              $scope.form.user.email.$setValidity('accountExists', !resp.exists);
              apply();
            });
          };

          $scope.submitUsername = function () {
            if ($scope.form.user.username.$valid) {
              $scope.sendingRequest = true;
              wmLoginService.createNewUser({
                user: $scope.user
              }, function (err, user) {
                $scope.selectUsername = false;
                $scope.welcomeModalIdx = getModalIdx();
                $scope.welcome = true;
                $scope.sendingRequest = false;
                apply();
              });
            }
          };

          $scope.continue = function () {
            $modalInstance.dismiss('done');
          };

          $scope.cancel = function () {
            wmLoginService.analytics.webmakerNewUserCancelled();
            $modalInstance.dismiss('cancel');
          };

          $scope.switchToLogin = function () {
            $modalInstance.close();
            $rootScope.wmTokenLogin($scope.user.email);
          };

          $scope.checkUsername = function () {
            if (!$scope.user.username) {
              return;
            }
            if (!wmRegex.username.test($scope.user.username)) {
              $scope.form.user.username.$setValidity('invalidUsername', false);
              return;
            }
            $scope.form.user.username.$setValidity('invalidUsername', true);
            $http
              .post(wmLoginService.urls.checkUsername, {
                username: $scope.user.username
              })
              .success(function (username) {
                $scope.form.user.username.$setValidity('taken', !username.exists);
                apply();
              })
              .error(function (err) {
                $scope.form.user.username.$setValidity('taken', true);
                apply();
              });
          };

          $scope.tryApp = function(app) {
            window.location = 'https://' + app + '.webmaker.org';
          };
        }
      }]
    };
  }
]);

module.directive('wmLogin', [
  function() {
    return {
      restrict: 'A',
      link: function($scope, $element) {
        $element.on('click', function() {
          $scope.wmTokenLogin();
        });
      },
      controller:['$rootScope', '$scope', '$http', '$modal', '$timeout', 'focus', 'wmLoginService', 'wmRegex',
        function($rootScope, $scope, $http, $modal, $timeout, focus, wmLoginService, wmRegex) {

          function apply() {
            if (!$rootScope.$$phase) {
              $rootScope.$apply();
            }
          }

          $rootScope.wmTokenLogin = function (uid, passwordReset) {
            $modal.open({
              templateUrl: 'login-modal.html',
              controller: tokenLoginController,
              resolve: {
                uid: function () {
                  return uid;
                },
                passwordReset: function() {
                  return !!passwordReset;
                }
              }
            }).opened
              .then(function () {
                focus('input[focus-on="login-uid"]');
              });
          };

          function tokenLoginController($scope, $modalInstance, uid, passwordReset) {

            var MODALSTATE = {
              enterUid: 0,
              checkEmail: 1,
              enterKey: 2,
              enterPassword: 3,
              resetRequestSent: 4
            };

            $scope.MODALSTATE = MODALSTATE;
            $scope.form = {};
            $scope.user = {};
            $scope.currentState = MODALSTATE.enterUid;
            $scope.sendingRequest = false;
            $scope.passwordReset = passwordReset;

            if (uid) {
              $scope.user.uid = uid;
            }

            $scope.switchToSignup = function () {
              var uid = $scope.user.uid,
                  isEmail = wmRegex.email.test(uid),
                  email = isEmail ? uid : '',
                  username = isEmail ? '' : uid;

              disableListeners();
              $modalInstance.close();
              $rootScope.wmCreateUser(email, username);
            };

            $scope.submitUid = function () {
              var input = $scope.user.uid;
              var isValid = wmRegex.username.test(input) || wmRegex.email.test(input);

              $scope.form.user.uid.$setValidity('invalid', isValid);

              if (!isValid) {
                return;
              }

              $scope.sendingRequest = true;

              wmLoginService.uidExists(input, function(err, resp) {
                $scope.sendingRequest = false;
                $scope.form.user.uid.$setValidity('tokenSendFailed', !err);
                $scope.form.user.uid.$setValidity('noAccount', resp.exists);
                if ( err ) {
                  $timeout(function () {
                    $scope.form.user.uid.$setValidity('tokenSendFailed', true);
                  }, 10000);
                }
                else if ( resp.exists  ) {
                  $scope.passwordReset = false;
                  if ( resp.usePasswordLogin ) {
                    $scope.currentState = MODALSTATE.enterPassword;
                    focus('input[focus-on="enter-password"]');
                    return apply();
                  } else {
                    return requestToken(resp.verified);
                  }
                }
                apply();
              });

              function requestToken(isVerified) {
                $scope.sendingRequest = true;
                wmLoginService.request($scope.user.uid, function (err) {
                  if (err) {
                    if ( err === "User not found" ) {
                      $scope.form.user.uid.$setValidity('noAccount', false);
                    } else {
                      $scope.form.user.uid.$setValidity('tokenSendFailed', false);
                      $timeout(function () {
                        $scope.form.user.uid.$setValidity('tokenSendFailed', true);
                      }, 10000);
                    }
                  } else {
                    if ( isVerified ) {
                      $scope.currentState = MODALSTATE.enterKey;
                      focus('input[focus-on="enter-key"]');
                    } else {
                      $scope.currentState = MODALSTATE.checkEmail;
                    }
                  }
                  $scope.sendingRequest = false;
                  apply();
                });
              }
            };

            $scope.submitKey = function() {
              $scope.sendingRequest = true;
              wmLoginService.authenticateToken($scope.user.uid, $scope.user.key, 'session', function(err) {
                $scope.sendingRequest = false;
                $scope.form.user.key.$setValidity('invalidKey', !err);
                if ( !err ) {
                  $scope.user.key = "";
                }
                apply();
              });
            };

            $scope.submitPassword = function() {
              $scope.sendingRequest = true;
              wmLoginService.verifyPassword($scope.user.uid, $scope.user.password, function(err, result) {
                $scope.sendingRequest = false;
                $scope.form.user.password.$setValidity('passLoginFailed', err ? false : result );
                apply();
              });
            };

            $scope.requestReset=function() {
              wmLoginService.requestResetCode($scope.user.uid, function(err) {
                $scope.form.user.password.$setValidity('resetRequestFailed', !err);
                if ( !err ) {
                  $scope.currentState = MODALSTATE.resetRequestSent;
                }
                apply();
              });
            };

            $scope.cancel = function () {
              disableListeners();
              $modalInstance.dismiss('cancel');
            };

            $scope.continue = function() {
              disableListeners();
              $modalInstance.dismiss('done');
            };

            $scope.usePersona = function() {
              disableListeners();
              $modalInstance.dismiss('done');
              $rootScope.login();
            };

            $scope.enterKey = function () {
              $scope.currentState = MODALSTATE.enterKey;
            };

            function disableListeners() {
              wmLoginService.off('login', $scope.continue);
              wmLoginService.off('tokenlogin', $scope.continue);
              wmLoginService.off('passwordlogin', $scope.continue);
            }

            wmLoginService.on('login', $scope.continue);
            wmLoginService.on('tokenlogin', $scope.continue);
            wmLoginService.on('passwordlogin', $scope.continue);
          }
        }
      ]
    };
  }
]);

module.directive('wmPasswordReset', [
  function() {
    // Prevent multiple dialogs
    var triggered = false;
    return {
      restrict: 'A',
      controller:['$rootScope', '$scope', '$location', '$modal', 'wmLoginService', 'passwordValidator',
        function($rootScope, $scope, $location, $modal, wmLoginService, passwordValidator) {

          var searchObj = $location.search();

          if (!searchObj.resetCode || !searchObj.uid || triggered) {
            return;
          }

          triggered = true;

          function apply() {
            if (!$rootScope.$$phase) {
              $rootScope.$apply();
            }
          }

          function passwordResetController($scope, $modalInstance, resetCode, uid) {
            $scope.form = {};
            $scope.password = {};
            $scope.sendingRequest = false;

            $scope.eightChars = angular.element('li.eight-chars');
            $scope.oneEachCase = angular.element('li.one-each-case');
            $scope.oneNumber = angular.element('li.one-number');

            if (!uid || !resetCode) {
              return $modalInstance.close();
            }

            $scope.checkPassword = function(blur) {
              passwordValidator($scope, $scope.password.value, blur);
              apply();
            };

            $scope.validateConfirmPassword = function(blur) {
              if ( !$scope.password.confirmValue ) {
                return $scope.form.password.value.$setValidity( 'noMatch', true );
              }
              $scope.passwordsMatch = $scope.password.value === $scope.password.confirmValue;
              if ( blur ) {
                $scope.form.password.value.$setValidity( 'noMatch', $scope.passwordsMatch );
              }
            };

            $scope.canSubmit = function() {
              return $scope.password.value && $scope.password.confirmValue && $scope.passwordsMatch;
            };

            $scope.submitReset = function () {
              wmLoginService.resetPassword( uid, resetCode, $scope.password.value, function(err) {
                if ( err ) {
                  try {
                    err = JSON.parse(err);
                    if ( err.passed === false ) {
                      $scope.form.password.value.$setValidity("weakPassword", false);
                    } else {
                      $scope.form.password.value.$setValidity("serverError", false);
                    }
                  } catch (ex) {
                    $scope.form.password.value.$setValidity("serverError", false);
                  }
                  return apply();
                }
                $scope.form.password.value.$setValidity("serverError", true);
                $scope.form.password.value.$setValidity("weakPassword", true);
                $location.search('uid', null);
                $location.search('resetCode', null);
                $modalInstance.close();
                $rootScope.wmTokenLogin(uid, true);
              });
            };

            $scope.cancel = function () {
              $modalInstance.dismiss('cancel');
            };
          }

          $modal.open({
            templateUrl: 'reset-modal.html',
            controller: passwordResetController,
            resolve: {
              resetCode: function() {
                return searchObj.resetCode;
              },
              uid: function () {
                return searchObj.uid;
              }
            }
          });
        }
      ]
    };
  }
]);

// Legacy Persona login
module.factory('wmPersonaListener', ['$modal', '$http', 'wmLoginService', 'wmRegex',
  function($modal, $http, wmLoginService, wmRegex) {
    wmLoginService.on('newuser', function (assertion) {
      $modal.open({
        templateUrl: 'legacy-create-user-modal.html',
        controller: createUserCtrl,
        resolve: {
          assertion: function () {
            return assertion;
          }
        }
      });
    });

    function createUserCtrl($scope, $modalInstance, wmLoginService, assertion) {

      $scope.form = {};
      $scope.user = {};

      $scope.checkUsername = function () {
        if (!$scope.form.user.username) {
          return;
        }
        if (!wmRegex.username.test($scope.form.user.username.$viewValue)) {
          $scope.form.user.username.$setValidity('invalid', false);
          return;
        }
        $scope.form.user.username.$setValidity('invalid', true);
        $http
          .post(wmLoginService.urls.checkUsername, {
            username: $scope.form.user.username.$viewValue
          })
          .success(function (username) {
            $scope.form.user.username.$setValidity('taken', !username.exists);
          })
          .error(function (err) {
            $scope.form.user.username.$setValidity('taken', true);
          });
      };

      $scope.createUser = function () {
        $scope.submit = true;
        if ($scope.form.user.$valid && $scope.form.agree) {
          wmLoginService.createUser({
            assertion: assertion,
            user: $scope.user
          });
          $modalInstance.close();
        }
      };

      $scope.cancel = function () {
        wmLoginService.analytics.webmakerNewUserCancelled();
        $modalInstance.dismiss('cancel');
      };
    }
  }
]);

module.directive('wmPersonaLogin', ['wmPersonaListener',
  function() {
    return {
      restrict: 'A',
      link: function($scope, $element) {
        $element.on('click', function() {
          $scope.login();
        });
      }
    };
  }
]);

module.directive('wmLogout', ['wmLoginService',
  function() {
    return {
      restrict: 'A',
      link: function($scope, $element) {
        $element.on('click', function() {
          $scope.logout();
        });
      }
    };
  }
]);
